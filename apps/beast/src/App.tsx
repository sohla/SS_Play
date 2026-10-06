import { useCallback } from 'react'
import { MotionInstrument } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { mapBeast, SILENCE_BELOW } from './mapping.ts'

export function App() {
  const map = useCallback((motion: Motion) => mapBeast(motion), [])

  return (
    <MotionInstrument
      title="beast"
      blurb={
        <>
          Five against four against seven, so the figure takes 140 notes to repeat. Shake it to
          drive it, turn it to open the filter, tilt and roll for the timbre.
        </>
      }
      instrument={{
        kind: 'conductor',
        clock: 'ssp_beast_clock',
        voice: 'ssp_beast',
        address: '/ssp_beast',
        controls: ([freq, pan]) => ({ freq: freq ?? 45, pan: pan ?? 0 }),
        // \legato in the original: the event system held the gate for part of
        // the step. The clock sends the time with the event.
        sustainS: ([, , sustain]) => sustain,
      }}
      map={map}
      silenceBelow={SILENCE_BELOW}
    />
  )
}
