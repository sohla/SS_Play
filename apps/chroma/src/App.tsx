import { useCallback, useEffect, useMemo, useRef } from 'react'
import { GridConductor, stepAt, stepStartMs, wallClockMs } from '@ss/engine'
import { useSampleSet, useSuperSonic } from '@ss/react'
import { MotionInstrument, type Mapped } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { FIRST, MIN_GAP_MS, css, nextColour } from './colour.ts'
import { PLOT_LABELS, RESTING, SILENCE_BELOW, chromaFrom, plotOf, type Chroma } from './mapping.ts'
import {
  LEVELS,
  LIBRARY,
  PHRASE_BARS,
  TICKS_PER_BAR,
  TICK_MS,
  eventsFor,
  hitAt,
  kitFrom,
  positionOf,
} from './phrase.ts'

/**
 * As `/birthday/`: the rhythm runs on its own `GridConductor` so it shares the
 * sync grid, and the shell is handed an instrument that schedules nothing. It
 * still has to be something — with none the shell never calls `map`, and the
 * phrase would never hear the phone.
 */
const PLACEHOLDER = { kind: 'client' as const, nextEvent: () => null }

/** An accent this late is from a backgrounded tab; its colour is history. */
const STALE_MS = 250

export function App() {
  const { status, session } = useSuperSonic()
  const booted = status.phase === 'ready' || status.phase === 'degraded'

  // Read by the scheduler off a timer, so refs rather than state.
  const now = useRef<Chroma>(RESTING)

  const { samples, progress, error } = useSampleSet(LIBRARY)
  const kit = useMemo(() => (samples ? kitFrom(samples) : null), [samples])

  /**
   * Accents scheduled but not yet heard, by tick.
   *
   * The conductor works ~120ms ahead of the sound, so the colour cannot change
   * when the event is *scheduled* — it would land before the hit. The frame loop
   * below waits for each tick's own wall-clock time, which is when the conductor
   * has arranged for it to come out of the speaker.
   */
  const accents = useRef<number[]>([])
  const colour = useRef(FIRST)

  useEffect(() => {
    const engine = session()
    if (!booted || !engine || !kit) return

    const grid = new GridConductor({
      session: engine,
      stepMs: TICK_MS,
      eventsFor: (tick) => {
        const hit = hitAt(tick, now.current.level)
        const events = eventsFor(hit, tick, now.current.amp, kit)
        if (hit?.accent && events.length > 0) accents.current.push(tick)
        return events
      },
    })
    grid.start()
    return () => {
      grid.dispose()
      accents.current = []
    }
  }, [booted, session, kit])

  // The colour, per frame, straight onto the root — never through React, since
  // this runs at display rate.
  useEffect(() => {
    if (!booted) return
    const root = document.documentElement
    let lastChange = -Infinity
    let frame = 0

    const paint = () => {
      const wall = wallClockMs()
      const queue = accents.current
      while (queue.length > 0 && stepStartMs(queue[0]!, TICK_MS) <= wall) {
        const tick = queue.shift()!
        const at = stepStartMs(tick, TICK_MS)
        if (wall - at > STALE_MS || at - lastChange < MIN_GAP_MS) continue
        colour.current = nextColour(colour.current, tick)
        root.style.setProperty('--chroma', css(colour.current))
        lastChange = at
      }
      frame = requestAnimationFrame(paint)
    }
    frame = requestAnimationFrame(paint)

    return () => {
      cancelAnimationFrame(frame)
      root.style.removeProperty('--chroma')
    }
  }, [booted])

  const map = useCallback((motion: Motion, sensitivity: number): Mapped => {
    const next = chromaFrom(motion, sensitivity)
    now.current = next
    const position = positionOf(stepAt(wallClockMs(), TICK_MS))

    return {
      dur: 0,
      level: next.amp > 0 ? motion.shake : 0,
      voice: {},
      traces: [],
      values: [
        ['phrase', LEVELS[next.level]!.name],
        ['amp', next.amp > 0 ? `${(20 * Math.log10(next.amp)).toFixed(1)}dB` : 'silent'],
        ['bar', `${Math.floor(position / TICKS_PER_BAR) + 1} of ${PHRASE_BARS}`],
        ['hue', `${colour.current.hue.toFixed(0)}°`],
      ],
    }
  }, [])

  return (
    <MotionInstrument
      title="chroma"
      blurb={
        <>
          A two-bar drum phrase in dotted rhythms and triplets, on the same clock as{' '}
          <code className="ak-accent">/sync/</code> &mdash; every phone plays the same bar.{' '}
          <strong>Move</strong> to bring it in and push it from dotted to triplets to dense; hold
          still and it stops. Each accent turns the screen a new colour, a long way round the wheel
          from the last, never more than three times a second.
        </>
      }
      instrument={PLACEHOLDER}
      map={map}
      silenceBelow={SILENCE_BELOW}
      plot={plotOf}
      plotLabels={PLOT_LABELS}
      ready={kit !== null}
      pending={
        error ? `Could not load ${error}` : `Loading the drums — ${progress.done} of ${progress.total}.`
      }
      pendingFailed={Boolean(error)}
    />
  )
}
