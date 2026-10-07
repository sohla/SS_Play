import { lincurve, type Motion } from '@ss/motion'
import type { Mapped } from '@ss/ui'

/**
 * multiBeatSynth1's `~next`, in TypeScript.
 *
 *   idx       = accelMassFiltered.lincurve(0, 1.5, 0, 2, 1).round.clip(0, 2)
 *   amp       = accelMassFiltered.lincurve(0, 1.0, -40, -10, -1)
 *   ffreq     = accelMassFiltered.lincurve(0, 1.0, 700,  6000, 2)
 *   rel       = accelMassFiltered.lincurve(0, 1.0, 0.1,  1.2,  2)
 *   droneAmp  = accelMassFiltered.lincurve(0, 2.0, -32, -10, -1)
 *   droneFreq = accelMassFiltered.lincurve(0, 1.0, 500,  3000, 2)
 *
 * One number drives everything, and `idx` is the interesting one: it selects a
 * subdivision rather than a value, so moving the hand changes how a half-second
 * bar is cut up — one note, two or four — rather than how fast it runs. Metric
 * modulation by movement.
 */
export const SILENCE_BELOW = 0.02

/** Subdivisions of the bar, and the pool the notes come from. */
export const DIVS = [1, 2, 4] as const
export const POOL = [0, 4, 7, 11, 12, 11, 7, 2] as const
export const BAR_S = 0.5

/**
 * The drone, an octave above where it started.
 *
 * It was 24 — C1, 32.7Hz — and the voice's loudest component is
 * `SinOsc.ar(freq / 2)` at 0.6 against the pulse's 0.5, which put most of its
 * energy at 16.3Hz: below hearing, and audible only as whatever the phone's
 * speaker folded back up. Only the quieter pulse was carrying the note.
 *
 * At 36 the sub lands on 32.7Hz and the pulse on 65.4Hz, so the two components
 * sit either side of where a bass actually speaks.
 */
export const DRONE_NOTE = 36

const dbamp = (db: number) => 10 ** (db * 0.05)

export interface MultiBeat {
  divIdx: number
  amp: number
  ffreq: number
  release: number
  droneAmp: number
  droneFfreq: number
}

export function multiBeatFrom(motion: Motion, sensitivity = 0.5): MultiBeat {
  
  // Sensitivity, AirKit style. Its personalities write
  // `lincurve(v, 0, TOP * sens, …)`; scaling the input is the same function, and
  // it is one line here instead of one per curve.
  //
  // The factor is `0.5 / sens`, not `1 / sens`, and that matters. The bounds in
  // this file were ported from a personality that has no `sens` at all, so they
  // are already the *effective* bounds — the ones the instrument actually used.
  // Dividing by AirKit's 0.5 default would therefore make every page twice as
  // hot as the thing it was ported from. 0.5 is the neutral point; the range and
  // the direction are still AirKit's.
  //
  // Clamped away from zero, which would be a division by it.
  const mass = motion.shake * 2 * (0.5 / Math.max(0.05, sensitivity))

  let ampDb = lincurve(mass, 0, 1, -40, -10, -1)
  let droneDb = lincurve(mass, 0, 2, -32, -10, -1)
  // The original's two floors. Below them it does not fade, it stops — which is
  // what makes holding the phone still a gesture rather than a quiet passage.
  if (ampDb < -39) ampDb = -90
  if (droneDb < -31) droneDb = -90

  return {
    divIdx: Math.min(Math.max(Math.round(lincurve(mass, 0, 1.5, 0, DIVS.length - 1, 1)), 0), DIVS.length - 1),
    amp: dbamp(ampDb),
    ffreq: lincurve(mass, 0, 1, 700, 6000, 2),
    release: lincurve(mass, 0, 1, 0.1, 1.2, 2),
    droneAmp: dbamp(droneDb),
    droneFfreq: lincurve(mass, 0, 1, 500, 3000, 2),
  }
}

export function mapMultiBeat(motion: Motion, sensitivity = 0.5): Mapped {
  const now = multiBeatFrom(motion, sensitivity)

  return {
    // The pattern decides its own step, so this is only here for the display.
    dur: BAR_S / DIVS[now.divIdx]!,
    level: motion.shake,
    voice: {},
    held: { amp: now.droneAmp, ffreq: now.droneFfreq },
    traces: [
      { label: 'move', hint: 'subdivision, level, filter', value: motion.shake * 2 - 1 },
    ],
    values: [
      ['notes/bar', String(DIVS[now.divIdx])],
      ['step', `${(BAR_S / DIVS[now.divIdx]!).toFixed(3)}s`],
      ['amp', now.amp.toFixed(4)],
      ['ffreq', `${now.ffreq.toFixed(0)}Hz`],
      ['release', `${now.release.toFixed(2)}s`],
      ['drone', now.droneAmp.toFixed(4)],
    ],
  }
}

/**
 * multiBeatSynth1.sc's `~plot`, ported.
 *
 *   [m.accelMass, m.accelMassFiltered, accelMassFiltered.lincurve(0, 2.0, -32, -10, -1).dbamp]
 *
 * The plotter polls this at 33Hz and keeps fifty frames, so these are the values
 * the mapping actually feeds its curves with a second and a half of history —
 * which is the readout that makes a gesture doing nothing visible.
 */
export function plotOf(motion: Motion, sensitivity = 0.5): number[] {
  return [motion.shakeRaw, motion.shake, multiBeatFrom(motion, sensitivity).droneAmp]
}

/** The series in colour order: yellow, magenta, cyan. */
export const PLOT_LABELS = ['move, raw', 'move, filtered', 'drone level']
