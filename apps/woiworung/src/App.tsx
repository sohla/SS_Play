import { useCallback, useRef } from 'react'
import { MotionInstrument } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { mapWoiworung, midiToFreq, NOTES, SILENCE_BELOW } from './mapping.ts'

export function App() {
  const index = useRef(0)
  const armed = useRef(false)

  const map = useCallback((motion: Motion) => {
    // The only event in the whole personality, and it fires on the way *up*
    // after a rest: going still arms it, moving advances the note. Striking by
    // stopping, which is a strange and rather good gesture.
    const level = motion.shake * 0.2
    if (level < SILENCE_BELOW) {
      armed.current = true
    } else if (armed.current) {
      armed.current = false
      index.current = (index.current + 1) % NOTES.length
    }

    return mapWoiworung(motion, midiToFreq(NOTES[index.current] as number))
  }, [])

  return (
    <MotionInstrument
      title="woiworung"
      blurb={
        <>
          AirKit&rsquo;s <code className="text-neutral-400">woiworung1</code>. One voice, held open,
          phase-modulating itself. Move it to sound; hold still and then move again to step to the
          next note.
        </>
      }
      instrument={{ kind: 'held', def: 'ssp_woi', initial: { amp: 0, gate: 1 } }}
      map={map}
      silenceBelow={SILENCE_BELOW}
    />
  )
}
