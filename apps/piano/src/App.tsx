import { useCallback, useMemo, useRef } from 'react'
import { useSampleSet } from '@ss/react'
import { MotionInstrument, type Mapped } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { PLOT_LABELS, SILENCE_BELOW, pianoFrom, plotOf, type Piano } from './mapping.ts'
import { arrangePiano, pianoPattern, type PianoState } from './pattern.ts'

/** Six samples, one per octave, C0 to C5. 10 seconds, about 13MB decoded. */
const LIBRARY = [
  'piano_C0.flac',
  'piano_C1.flac',
  'piano_C2.flac',
  'piano_C3.flac',
  'piano_C4.flac',
  'piano_C5.flac',
]

const RESTING: Piano = { amp: 0, dur: 0.5 }

export function App() {
  const { samples, progress, error } = useSampleSet(LIBRARY)

  const now = useRef<Piano>(RESTING)
  // The last note's lookup, written by the pattern and read by the display. A
  // ref because the pattern runs ahead of the sound on its own schedule and has
  // no business re-rendering anything.
  const state = useRef<PianoState>({
    last: { bufnum: 0, shift: 0, index: 0, name: '', midi: 0 },
  })


  const library = useMemo(() => (samples ? arrangePiano(samples) : null), [samples])

  const nextEvent = useMemo(
    () => (library ? pianoPattern(library, () => now.current, state.current) : () => null),
    [library],
  )

  const map = useCallback((motion: Motion, sensitivity: number): Mapped => {
    const next = pianoFrom(motion, sensitivity)
    now.current = next
    const last = state.current.last

    return {
      dur: next.dur,
      level: next.amp,
      voice: {},
      traces: [{ label: 'move', hint: 'louder, and faster', value: motion.shake * 2 - 1 }],
      values: [
        ['note', `${last.midi}`],
        // The number this page exists to show: how far the chosen sample had to
        // be stretched to reach the note.
        ['shift', `${last.shift > 0 ? '+' : ''}${last.shift}`],
        ['sample', last.name.replace(/^piano_|\.flac$/g, '') || '—'],
        ['notes/s', next.dur > 0 ? (1 / next.dur).toFixed(1) : '0'],
      ],
    }
  }, [])

  return (
    <MotionInstrument
      title="piano"
      blurb={
        <>
          Six piano samples, one per octave, and an arpeggio that climbs four octaves &mdash; so
          almost every note is played by stretching the wrong sample, up to eleven semitones. The
          readout says which sample and how far. Move to play: harder is louder and faster at once.
        </>
      }
      instrument={useMemo(() => ({ kind: 'client' as const, nextEvent }), [nextEvent])}
      map={map}
      silenceBelow={SILENCE_BELOW}
      plot={plotOf}
      plotLabels={PLOT_LABELS}
      ready={library !== null}
      pending={
        error
          ? `Could not load ${error}`
          : `Loading 6 piano samples — ${progress.done} of ${progress.total}, `
            + `${(progress.decodedBytes / 1048576).toFixed(2)}MB decoded.`
      }
      pendingFailed={error !== null}
    />
  )
}
