import { useCallback, useMemo, useRef } from 'react'
import { seq, xrandOf, type ScheduledEvent } from './patterns.ts'
import { MotionInstrument } from '@ss/ui'
import type { Motion } from '@ss/motion'
import {
  BAR_STEPS,
  NOTES,
  OCTAVES,
  PAD_NOTE,
  REST_AT,
  ROOTS,
  SILENCE_BELOW,
  STEP_S,
  mapTrainBass,
  trainBassFrom,
  type TrainBass,
} from './mapping.ts'

const midiToFreq = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

export function App() {
  const now = useRef<TrainBass>(trainBassFrom({ shake: 0 } as Motion))
  /** The pad follows the pattern's key, as the original's ~onEvent does. */
  const padFreq = useRef(midiToFreq(PAD_NOTE))

  const nextEvent = useMemo(() => {
    const note = seq(NOTES, Infinity)()
    const octave = seq(OCTAVES, Infinity)()
    // Pseq([0,-2,0,3].stutter(32)) — the key moves every 32 notes.
    const root = seq(ROOTS.flatMap((r) => Array<number>(32).fill(r)), Infinity)()
    const pan = xrandOf([-0.5, 0.5])
    let step = 0

    return (): ScheduledEvent => {
      const held = now.current
      const thisNote = note.next() ?? 0
      const thisOctave = octave.next() ?? 3
      const thisRoot = root.next() ?? 0
      const resting = step % BAR_STEPS === REST_AT
      step += 1

      padFreq.current = midiToFreq(PAD_NOTE + thisRoot)

      return {
        def: 'ssp_tb_perc',
        dur: STEP_S,
        rest: resting,
        controls: {
          freq: midiToFreq(thisNote + thisRoot + thisOctave * 12),
          // `Pkey(\octave).squared * 0.05` — a value derived from another key,
          // which is the kind of thing a Demand graph has no way to say.
          decay: thisOctave * thisOctave * 0.05,
          filtFreq: held.filtFreq,
          filtRes: 1.0,
          amp: held.amp,
          pan: pan(),
        },
      }
    }
  }, [])

  const map = useCallback((motion: Motion) => {
    now.current = trainBassFrom(motion)
    const mapped = mapTrainBass(motion)
    return { ...mapped, held: { ...mapped.held, freq: padFreq.current } }
  }, [])

  return (
    <MotionInstrument
      title="train bass"
      blurb={
        <>
          A thirty-two step figure over a pad that slides to follow it, with every third beat
          silent. Move the phone to play &mdash; it brightens the drum and speeds the pad&rsquo;s
          breathing together.
        </>
      }
      instrument={useMemo(
        () => [
          { kind: 'client' as const, nextEvent },
          {
            kind: 'held' as const,
            def: 'ssp_tb_pad',
            initial: { gate: 1, amp: 0.1, freq: midiToFreq(PAD_NOTE) },
          },
        ],
        [nextEvent],
      )}
      map={map}
      silenceBelow={SILENCE_BELOW}
    />
  )
}
