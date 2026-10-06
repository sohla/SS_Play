import { useCallback } from 'react'
import { MotionInstrument } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { mapLeaves, SILENCE_BELOW } from './mapping.ts'

export function App() {
  const map = useCallback((motion: Motion) => mapLeaves(motion), [])

  return (
    <MotionInstrument
      title="leaves"
      blurb={
        <>
          Noise chopped into grains and sparse impulses over the top &mdash; a surface being
          disturbed rather than a hiss. Move to play, tilt to go from soft to crisp, turn to change
          how fast the grains come. It takes four seconds to arrive.
        </>
      }
      instrument={{ kind: 'held', def: 'ssp_leaf', initial: { gate: 1, amp: 0 } }}
      map={map}
      silenceBelow={SILENCE_BELOW}
    />
  )
}
