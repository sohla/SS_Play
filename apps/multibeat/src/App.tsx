import { useCallback, useMemo, useRef } from 'react'
import { pn, seq, series, switchOn, type ScheduledEvent } from '@ss/engine'
import { MotionInstrument } from '@ss/ui'
import type { Motion } from '@ss/motion'
import {
  BAR_S,
  DIVS,
  DRONE_NOTE,
  POOL,
  SILENCE_BELOW,
  mapMultiBeat,
  multiBeatFrom,
  type MultiBeat,
} from './mapping.ts'

const midiToFreq = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

export function App() {
  // What the phone is holding, read by the pattern when it pulls an event
  // rather than pushed to it. The conductor runs ahead of the sound, so an
  // event takes the values that were current when it was *scheduled*.
  const now = useRef<MultiBeat>(multiBeatFrom({ shake: 0 } as Motion))

  const nextEvent = useMemo(() => {
    const index = () => now.current.divIdx

    // Three switches on one index, exactly as the Pbind has it. They stay in
    // step because they are pulled together — which is the thing a Demand graph
    // cannot promise.
    const div = switchOn(DIVS.map((n) => pn(n, n)), index)()
    const step = switchOn(DIVS.map((n) => series(0, 1, n)), index)()
    const note = switchOn(DIVS.map((n) => seq(POOL.slice(0, n))), index)()

    return (): ScheduledEvent | null => {
      const held = now.current
      const thisDiv = div.next() ?? 1
      step.next()
      const thisNote = note.next() ?? 0

      // Silence is a level, not a pause: the pattern keeps its place so the
      // bar does not restart every time the hand stops.
      const octave = 4 + Math.floor(Math.random() * 3)

      return {
        def: 'ssp_mb_voice',
        dur: BAR_S / thisDiv,
        controls: {
          freq: midiToFreq(thisNote + octave * 12),
          amp: held.amp,
          ffreq: held.ffreq,
          release: held.release,
          attack: 0.0003,
          pan: -0.2 + Math.random() * 0.4,
        },
      }
    }
  }, [])

  const map = useCallback((motion: Motion) => {
    now.current = multiBeatFrom(motion)
    return mapMultiBeat(motion)
  }, [])

  return (
    <MotionInstrument
      title="multibeat"
      blurb={
        <>
          A half-second bar cut into one, two or four — moving the phone changes the subdivision
          rather than the tempo, so the figure shifts gear instead of speeding up. A drone holds
          underneath and swells with it.
        </>
      }
      instrument={useMemo(
        () => [
          { kind: 'client' as const, nextEvent },
          {
            kind: 'held' as const,
            def: 'ssp_mb_drone',
            initial: { gate: 1, amp: 0.025, freq: midiToFreq(DRONE_NOTE), ffreq: 500 },
          },
        ],
        [nextEvent],
      )}
      map={map}
      silenceBelow={SILENCE_BELOW}
    />
  )
}
