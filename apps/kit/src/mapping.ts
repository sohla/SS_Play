import { lincurve, type Motion } from '@ss/motion'

/**
 * multiBeat4's `~next`, in TypeScript.
 *
 *   idx    = accelMassFiltered.lincurve(0, 1.3, 0, divs.size - 1, 1).round
 *   pal    = accelMassFiltered.lincurve(0, 1.2, 1, buffers.size, 1).round
 *   amp    = accelMassFiltered.lincurve(0, 0.5, -10, -5, -1);  -90 below -9
 *   roll   = (gyroX / pi).fold(-0.5, 0.5).linlin(-0.5, 0.5, 0.75, 1.25)
 *   cutoff = ((gyroZ / pi).fold(-0.5, 0.5) * 2).lincurve(-1, 1, 40, 900, 1)
 *
 * One number drives three of those, and `idx` is the one that matters: it
 * selects which of three subdivisions the bar is cut into. Moving the hand
 * changes the rhythm's resolution rather than its speed — the same metric
 * modulation the synth multibeat does, with a kit instead of an oscillator.
 *
 * `pal` is the quieter idea. It is the *size* of the palette the non-kick steps
 * choose from, not a choice itself, so energy widens the set of drums in play
 * rather than picking a different one. The buffers are sorted short to long, so
 * a small palette is the short, dry sounds and a large one reaches the rides.
 */

/** Subdivisions of a half-second bar. Three of them: the page's whole point. */
export const DIVS = [2, 4, 8] as const
export const BEAT_S = 0.5

/** `rates.choose` per event, including one reverse. */
export const RATES = [1, 1, 1, 0.5, 2, 1.5, -1] as const

export const SILENCE_BELOW = 0.0002

const linlin = (v: number, a: number, b: number, c: number, d: number) =>
  c + ((d - c) * (Math.min(Math.max(v, a), b) - a)) / (b - a)

const dbamp = (db: number) => 10 ** (db * 0.05)

/** sclang's `fold`, which reflects at the bounds rather than clamping. */
const fold = (value: number, lo: number, hi: number) => {
  const span = hi - lo
  if (span <= 0) return lo
  const shifted = ((((value - lo) % (2 * span)) + 2 * span) % (2 * span))
  return lo + (shifted > span ? 2 * span - shifted : shifted)
}

export interface Kit {
  divIdx: number
  /** How many of the sorted buffers the non-kick steps may choose from. */
  palette: number
  energy: number
  roll: number
  cutoff: number
}

export function kitFrom(motion: Motion, buffers: number, sensitivity = 0.5): Kit {
  // accelMassFiltered reaches ~1.3 at the top of the original's curve; shake is
  // already 0..1, so it is scaled to the same travel rather than remapped.
  
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
  const mass = motion.shake * 1.3 * (0.5 / Math.max(0.05, sensitivity))

  let db = lincurve(mass, 0, 0.5, -10, -5, -1)
  // The original's own dead zone: below -9dB it drops to -90, which is silence
  // rather than a quiet kit.
  if (db < -9) db = -90

  return {
    divIdx: Math.min(
      Math.max(Math.round(lincurve(mass, 0, 1.3, 0, DIVS.length - 1, 1)), 0),
      DIVS.length - 1,
    ),
    palette: Math.min(
      Math.max(Math.round(lincurve(mass, 0, 1.2, 1, buffers, 1)), 1),
      Math.max(1, buffers),
    ),
    energy: dbamp(db),
    // gyroEvent.x / pi, folded — so rolling past the bound comes back rather
    // than sticking at the end of its travel.
    roll: linlin(fold(motion.roll, -0.5, 0.5), -0.5, 0.5, 0.75, 1.25),
    cutoff: lincurve(fold(motion.yaw * 2 - 1, -0.5, 0.5) * 2, -1, 1, 40, 900, 1),
  }
}

/**
 * multiBeat4.sc's `~plot`, ported.
 *
 *   [m.accelMass, m.accelMassFiltered]
 *
 * The plotter polls this at 33Hz and keeps fifty frames, so these are the values
 * the mapping actually feeds its curves with a second and a half of history —
 * which is the readout that makes a gesture doing nothing visible.
 */
export function plotOf(motion: Motion, sensitivity = 0.5): number[] {
  return [motion.shakeRaw, motion.shake]
}

/** The series in colour order: yellow, magenta, cyan. */
export const PLOT_LABELS = ['move, raw', 'move, filtered']
