import { useCallback } from 'react'
import { MotionInstrument } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { mapChime, SILENCE_BELOW } from './mapping.ts'

export function App() {
  const map = useCallback((motion: Motion) => mapChime(motion), [])

  return (
    <MotionInstrument
      title="chime"
      blurb={
        <>
          AirKit&rsquo;s <code className="text-neutral-400">wingChimes3</code>. Grains of noise
          through a filter narrow enough to ring. Move it and it goes from a hiss to a struck bar;
          tilt it to change how often they strike.
        </>
      }
      instrument={{
        kind: 'conductor',
        clock: 'ssp_chime_clock',
        voice: 'ssp_chime',
        address: '/ssp_chime',
        controls: ([freq, pulseFreq]) => ({ freq: freq ?? 1000, pulseFreq: pulseFreq ?? 5 }),
        sustainS: ([, , dur]) => dur,
      }}
      map={map}
      silenceBelow={SILENCE_BELOW}
    />
  )
}
