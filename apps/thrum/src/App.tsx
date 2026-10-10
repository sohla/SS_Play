import { useCallback } from 'react'
import { MotionInstrument } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { PLOT_LABELS, SILENCE_BELOW, mapThrum, plotOf } from './mapping.ts'

/**
 * Three layers, two synths, and the split is not arbitrary.
 *
 * Layer one is a `conductor`: a demand sequence in the server reporting each tap
 * with `SendReply`, and a node spawned per report. Right for this layer and only
 * this layer, because at under 6Hz the events are individually felt — so what
 * the Demand graph buys is that a stalled main thread cannot smear them.
 *
 * Layers two and three are one `held` voice, and could not be conductors. Their
 * rates run to 90Hz, where the OSC round trip is the same order as the interval
 * between events: the rate the hand asked for and the rate the skin received
 * would be different numbers. They are a pulse train and a tone inside the
 * graph instead, with their accents on a demand sequence the train pulls itself
 * — a pattern in the server with no OSC traffic at all.
 *
 * They are one SynthDef rather than two because excursion is shared and so their
 * limiter has to be; see the note in `ssp_thrum_bed`.
 */
const INSTRUMENT = [
  {
    kind: 'conductor' as const,
    clock: 'ssp_thrum_clock',
    voice: 'ssp_thrum_tap',
    address: '/ssp_thrum',
    controls: ([freq, hard]: readonly number[]) => ({ freq: freq ?? 250, hard: hard ?? 0.6 }),
    // No `sustainS`. A tap is a fixed-length percussive envelope with
    // doneAction 2 — it frees itself, and there is nothing to hold. The gate
    // exists so the def is releasable like every other one here, not because
    // this page uses it.
  },
  { kind: 'held' as const, def: 'ssp_thrum_bed', initial: { flutAmp: 0, carAmp: 0 } },
]

export function App() {
  const map = useCallback((motion: Motion, sensitivity: number) => mapThrum(motion, sensitivity), [])

  return (
    <MotionInstrument
      title="thrum"
      blurb={
        <>
          Sound aimed at the hand rather than the ear. Everything here sits near{' '}
          <strong>250Hz</strong>, where skin is most sensitive and a phone speaker has stopped
          radiating and started shaking. <strong>Shake</strong> for separate taps,{' '}
          <strong>turn</strong> to run the pulse rate up until they fuse into one buzz, and{' '}
          <strong>tilt</strong> to set the carrier underneath. Best felt with the phone loose in a
          palm, volume up, and nothing between it and your skin.
        </>
      }
      instrument={INSTRUMENT}
      map={map}
      silenceBelow={SILENCE_BELOW}
      plot={plotOf}
      plotLabels={PLOT_LABELS}
      // The three drives are 0..1, not bipolar. Left at -1..1 the traces would
      // all sit in the top half of the plot and waste half of it.
      plotMin={0}
      plotMax={1}
    />
  )
}
