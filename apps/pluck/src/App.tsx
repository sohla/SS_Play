import { useCallback } from 'react'
import { MotionInstrument } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { mapPluck, SILENCE_BELOW } from './mapping.ts'

export function App() {
  const map = useCallback((motion: Motion) => mapPluck(motion), [])

  return (
    <MotionInstrument
      title="pluck"
      blurb={
        <>
          A plucked string struck by an impulse train, where one gesture moves both how often
          it is struck and how long the string is. Knock it to pitch it, move it to play it.
        </>
      }
      // gate is 0 by default in this def, so the voice can exist before anything
      // wants to hear it. Opened here, once.
      instrument={{ kind: 'held', def: 'ssp_pluck', initial: { gate: 1, amp: 0 } }}
      map={map}
      silenceBelow={SILENCE_BELOW}
    />
  )
}
