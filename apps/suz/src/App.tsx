import { useCallback } from 'react'
import { MotionInstrument } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { mapSuz, SILENCE_BELOW } from './mapping.ts'

export function App() {
  const map = useCallback((motion: Motion) => mapSuz(motion), [])

  return (
    <MotionInstrument
      title="suz"
      blurb={
        <>
          AirKit&rsquo;s <code className="text-neutral-400">suz1</code>. A nine-note melody against
          a sixteen-step octave, so the two drift apart and meet again every 144 notes. Move the
          phone to play; move it more and it closes up.
        </>
      }
      instrument={{
        kind: 'conductor',
        clock: 'ssp_suz_clock',
        voice: 'ssp_suz',
        address: '/ssp_suz',
        controls: ([freq]) => ({ freq: freq ?? 440 }),
        sustainS: ([, dur]) => dur,
      }}
      map={map}
      silenceBelow={SILENCE_BELOW}
    />
  )
}
