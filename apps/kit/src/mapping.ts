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

export function kitFrom(motion: Motion, buffers: number): Kit {
  // accelMassFiltered reaches ~1.3 at the top of the original's curve; shake is
  // already 0..1, so it is scaled to the same travel rather than remapped.
  const mass = motion.shake * 1.3

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
