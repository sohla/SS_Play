import { useCallback } from 'react'
import { MotionInstrument } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { mapMoog, SILENCE_BELOW } from './mapping.ts'

export function App() {
  const map = useCallback((motion: Motion) => mapMoog(motion), [])

  return (
    <MotionInstrument
      title="moog"
      blurb={
        <>
          AirKit&rsquo;s <code className="text-neutral-400">miniMoog</code>. Three detuned
          oscillators through a resonant lowpass, five against six against two so the figure takes
          thirty notes to come round and 180 before it does so in the same key.
        </>
      }
      instrument={{
        kind: 'conductor',
        clock: 'ssp_moog_clock',
        voice: 'ssp_moog',
        address: '/ssp_moog',
        // The clock chooses the release per event, so it is born with it rather
        // than taking whatever the phone happens to be holding.
        controls: ([freq, pan, release]) => ({
          freq: freq ?? 440,
          pan: pan ?? 0,
          release: release ?? 0.3,
        }),
        sustainS: ([, , , dur]) => dur,
      }}
      map={map}
      silenceBelow={SILENCE_BELOW}
    />
  )
}
