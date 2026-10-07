import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadSampleSet, type LoadedSample } from '@ss/engine'
import { useSession } from '@ss/react'
import { MotionInstrument, type Mapped } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { DIVS, SILENCE_BELOW, marimbaFrom, type Marimba } from './mapping.ts'
import { arrangeMarimba, marimbaPattern, type MarimbaState } from './pattern.ts'

/**
 * Ten bars, named by the MIDI note each was recorded at.
 *
 * The original scans eighteen; these are the ten the lookup can ever select, each
 * trimmed to three seconds — just past the 2.6s the envelope can hold one open at
 * its longest. 18.5 seconds in total, about 24MB of memory.
 */
const LIBRARY = [47, 53, 59, 62, 65, 71, 74, 77, 83, 86].map((midi) => `mar_${midi}.flac`)

const RESTING: Marimba = { divIdx: 0, energy: 0, panBias: 0 }

export function App() {
  const session = useSession()
  const [samples, setSamples] = useState<LoadedSample[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const now = useRef<Marimba>(RESTING)
  const state = useRef<MarimbaState>({ last: { midi: 0, shift: 0, sample: 0, div: 1 } })

  useEffect(() => {
    if (!session || samples) return
    let cancelled = false

    loadSampleSet({ session, names: LIBRARY })
      .then((loaded) => {
        if (!cancelled) setSamples(loaded)
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message)
      })

    return () => {
      cancelled = true
    }
  }, [session, samples])

  const library = useMemo(() => (samples ? arrangeMarimba(samples) : null), [samples])

  const nextEvent = useMemo(
    () => (library ? marimbaPattern(library, () => now.current, state.current) : () => null),
    [library],
  )

  const map = useCallback((motion: Motion): Mapped => {
    const next = marimbaFrom(motion)
    now.current = next
    const last = state.current.last

    return {
      dur: 0,
      level: next.energy,
      voice: {},
      traces: [
        { label: 'move', hint: 'subdivision, and level', value: motion.shake * 2 - 1 },
        { label: 'turn', hint: 'pan', value: motion.yaw * 2 - 1 },
      ],
      values: [
        ['bar', `${DIVS[next.divIdx]} steps`],
        ['notes', `${DIVS[next.divIdx]} of 8`],
        ['note', `${last.midi}`],
        // Never more than two semitones: the marimba has four pitches per octave,
        // so a neighbour is always close.
        ['shift', `${last.shift > 0 ? '+' : ''}${last.shift}`],
      ],
    }
  }, [])

  return (
    <MotionInstrument
      title="marimba"
      blurb={
        <>
          Struck wooden bars, over a half-second bar cut into one, two, four or eight. Moving
          changes how finely it is divided and how far down the note pool it reaches &mdash; and
          because the octave walks on every note rather than every bar, the same twelve-note descent
          reads as a slow fall when the bar is coarse and an arpeggio when it is fine. Turn to pan.
        </>
      }
      instrument={useMemo(() => ({ kind: 'client' as const, nextEvent }), [nextEvent])}
      map={map}
      silenceBelow={SILENCE_BELOW}
      ready={library !== null}
      pending={
        error ? `The library did not load: ${error}` : `Loading 10 marimba bars — about 24MB.`
      }
    />
  )
}
