import { useCallback, useEffect, useRef } from 'react'
import { GridConductor, stepAt, wallClockMs } from '@ss/engine'
import { useSuperSonic } from '@ss/react'
import { MotionInstrument, type Mapped } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { HAPPY_BIRTHDAY } from './happy-birthday.ts'
import { chordsPerBar } from './harmony.ts'
import { PLOT_LABELS, RESTING_GESTURE, gestureFrom, plotOf, type Gesture } from './mapping.ts'
import { SILENT_BELOW, descantAt, freshDescant, melodyAt, positionOf } from './song.ts'

const CHORDS = chordsPerBar(HAPPY_BIRTHDAY)

/**
 * `MotionInstrument` starts and stops its instruments on the motion level, and
 * sends nothing until a sensor has reported — right for a page that is silent
 * until you move, wrong for a tune that must loop regardless. So the song runs on
 * its own `GridConductor`, built here at boot, and the shell is given a
 * placeholder that schedules nothing, as `combo` does before its samples load.
 * It still has to be *something*: with no instruments the shell never calls
 * `map`, and the descant would never hear the phone.
 */
const PLACEHOLDER = { kind: 'client' as const, nextEvent: () => null }

export function App() {
  const { status, session } = useSuperSonic()
  const booted = status.phase === 'ready' || status.phase === 'degraded'

  // Read by the scheduler off a timer, so refs rather than state.
  const gesture = useRef<Gesture>({ ...RESTING_GESTURE })
  const descant = useRef(freshDescant())

  useEffect(() => {
    const engine = session()
    if (!booted || !engine) return

    // The wall-clock grid rather than a ClientConductor: the melody and the
    // descant read the same absolute step, so the descant always knows which bar
    // — and so which chord — the tune is in. Two phones also land in the same
    // place in the song, which comes free with it.
    const grid = new GridConductor({
      session: engine,
      stepMs: HAPPY_BIRTHDAY.stepMs,
      eventsFor: (step) => [
        ...melodyAt(HAPPY_BIRTHDAY, step),
        ...descantAt(HAPPY_BIRTHDAY, CHORDS, step, gesture.current, descant.current),
      ],
    })
    grid.start()
    return () => grid.dispose()
  }, [booted, session])

  const map = useCallback((motion: Motion, sensitivity: number): Mapped => {
    const next = gestureFrom(motion, sensitivity, gesture.current)
    gesture.current = next

    const now = descant.current
    const step = stepAt(wallClockMs(), HAPPY_BIRTHDAY.stepMs)
    const bar = Math.floor(positionOf(HAPPY_BIRTHDAY, step) / HAPPY_BIRTHDAY.stepsPerBar)

    return {
      dur: 0,
      // Only the descant answers to this; the melody plays whatever it says.
      level: next.energy >= SILENT_BELOW ? next.energy : 0,
      voice: {},
      traces: [],
      values: [
        ['bar', `${bar + 1} of ${HAPPY_BIRTHDAY.loopSteps / HAPPY_BIRTHDAY.stepsPerBar}`],
        ['chord', now.chord || '—'],
        ['descant', now.every === 0 ? 'resting' : `every ${now.every} / 16`],
        ['register', now.register || '—'],
        ['note', now.last ? String(now.last) : '—'],
      ],
    }
  }, [])

  return (
    <MotionInstrument
      title="happy birthday"
      blurb={
        <>
          The tune loops on its own, from a MIDI file. Around it, a second voice plays only the
          notes that fit the bar it is in &mdash; chord tones on the beat, scale tones between,
          never a semitone off the melody and never across it. <strong>Shake</strong> to bring it
          in and quicken it, <strong>tilt</strong> the phone up to lift it above the tune or down
          for a bass line, <strong>turn</strong> to let it climb further, and{' '}
          <strong>flick</strong> for an accent an octave up.
        </>
      }
      instrument={PLACEHOLDER}
      map={map}
      silenceBelow={SILENT_BELOW}
      plot={plotOf}
      plotLabels={PLOT_LABELS}
    />
  )
}
