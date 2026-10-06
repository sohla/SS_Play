import { useCallback, useMemo, useRef } from 'react'
import { seq, white, type ScheduledEvent } from '@ss/engine'
import { MotionInstrument } from '@ss/ui'
import type { Motion } from '@ss/motion'
import {
  NOTES,
  ROOT,
  SILENCE_BELOW,
  STEP_S,
  mapTrainMelody,
  trainMelodyFrom,
  type TrainMelody,
} from './mapping.ts'

const midiToFreq = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

export function App() {
  const now = useRef<TrainMelody>(trainMelodyFrom({ shake: 0, pitch: 0, roll: 0 } as Motion))

  const nextEvent = useMemo(() => {
    const note = seq(NOTES, Infinity)()
    const atk = white(0.002, 0.04)()
    const pan = seq([-0.3, 0.3], Infinity)()

    return (): ScheduledEvent => {
      const held = now.current
      return {
        def: 'ssp_tm_voice',
        dur: STEP_S,
        // envSus is 0 in the pattern, so a note decays rather than holding —
        // the gate still has to fall for the release to run at all.
        sustain: STEP_S * 0.9,
        controls: {
          freq: midiToFreq((note.next() ?? 0) + ROOT + held.octave * 12),
          envAtk: atk.next() ?? 0.01,
          envSus: 0,
          envDec: held.envDec,
          envRel: held.envRel,
          amp: held.amp,
          filtFreq: held.filtFreq,
          filtRes: held.filtRes,
          pan: pan.next() ?? 0,
        },
      }
    }
  }, [])

  const map = useCallback((motion: Motion) => {
    now.current = trainMelodyFrom(motion)
    return mapTrainMelody(motion)
  }, [])

  return (
    <MotionInstrument
      title="train melody"
      blurb={
        <>
          A five-note figure at a fixed step, three oscillators a hundredth apart. Tilt{' '}
          <em>down</em> to raise the octave, roll to sweep the filter against its own resonance,
          move to play at all.
        </>
      }
      instrument={useMemo(() => ({ kind: 'client' as const, nextEvent }), [nextEvent])}
      map={map}
      silenceBelow={SILENCE_BELOW}
    />
  )
}
