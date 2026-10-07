import { useCallback } from 'react'
import { MotionInstrument } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { NOTES, PLOT_LABELS, SILENCE_BELOW, mapGendy, midiToFreq, plotOf } from './mapping.ts'

export function App() {
  const map = useCallback((motion: Motion, sensitivity: number) => mapGendy(motion, sensitivity), [])

  return (
    <MotionInstrument
      title="gendy"
      blurb={
        <>
          Twenty oscillators that do not play a waveform so much as invent one, by a random walk
          that never quite settles. Move to play and to spread the swarm, tilt to pick the note,
          turn to change the size of the room it is in.
        </>
      }
      instrument={{
        kind: 'held',
        def: 'ssp_gendy',
        initial: { gate: 1, amp: 0, freq: midiToFreq(NOTES[0] as number) },
      }}
      map={map}
      silenceBelow={SILENCE_BELOW}
      plot={plotOf}
      plotLabels={PLOT_LABELS}
    />
  )
}
