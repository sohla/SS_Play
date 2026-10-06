import { useCallback } from 'react'
import { MotionInstrument } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { mapMelChair, SILENCE_BELOW } from './mapping.ts'

export function App() {
  // Stable across renders: MotionInstrument reads it on an interval, and a new
  // function each render would restart the timers.
  const map = useCallback((motion: Motion) => mapMelChair(motion), [])

  return (
    <MotionInstrument
      title="melchair"
      blurb={
        <>
          AirKit&rsquo;s <code className="text-neutral-400">melChair3</code>. A rising and falling
          figure on a sine fed back through itself. Turn the phone to play it &mdash; faster
          turning, faster notes; hold it still and it stops.
        </>
      }
      conductor={{
        clock: 'ssp_mel_clock',
        voice: 'ssp_mel',
        address: '/ssp_mel',
        controls: ([freq]) => ({ freq: freq ?? 440 }),
        // No \legato in the original, so the event system held the gate for
        // exactly one step. An adsr needs that to reach its release.
        sustainS: ([, dur]) => dur,
      }}
      map={map}
      silenceBelow={SILENCE_BELOW}
    />
  )
}
