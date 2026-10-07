import { useCallback } from 'react'
import { MotionInstrument } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { PLOT_LABELS, SILENCE_BELOW, mapSuz, plotOf } from './mapping.ts'

export function App() {
  const map = useCallback((motion: Motion, sensitivity: number) => mapSuz(motion, sensitivity), [])

  return (
    <MotionInstrument
      title="suz"
      blurb={
        <>
          A nine-note melody against a sixteen-step octave, so the two drift apart and meet
          again every 144 notes. Move the phone to play &mdash; move it more and it closes up.
          Tilt to shift the register.
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
      plot={plotOf}
      plotLabels={PLOT_LABELS}
    />
  )
}
