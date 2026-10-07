import { lincurve, type Motion } from '@ss/motion'

/**
 * dulcimer1's `~next`, in TypeScript.
 *
 *   idx = accelMassFiltered.lincurve(0, 0.3, 0, divs.size - 1, 2).round
 *   amp = accelMassFiltered.lincurve(0, 0.3, -40, -10, -2);  -120 below -39
 *
 * Both curves saturate at 0.3 — a tenth of the travel the other personalities
 * use — and both have curve 2, which bends them *away* from the top. So the
 * instrument is deliberately twitchy at the bottom and flat above a small
 * movement: a tap takes it from silence to the six-note subdivision, and shaking
 * harder than that changes almost nothing.
 */

/** Subdivisions of a half-second bar. Six, not eight, which is what makes it lilt. */
export const DIVS = [2, 4, 6] as const
export const BEAT_S = 0.5

/** The note pool, read `keep(div)` deep — so a finer bar uses more of it. */
export const POOL = [0, 11, 7, 4, 2, -5] as const

/** `Pseq([4, 3, 2].stutter(2), inf)` — two bars per octave, descending. */
export const OCTAVES = [4, 4, 3, 3, 2, 2] as const

export const SILENCE_BELOW = 1e-5

const dbamp = (db: number) => 10 ** (db * 0.05)

export interface Dulcimer {
  divIdx: number
  amp: number
}

export function dulcimerFrom(motion: Motion): Dulcimer {
  // accelMassFiltered against a curve that saturates at 0.3; shake is 0..1 and
  // is passed through, so the top of the curve is reached early — as it is in
  // the original.
  const mass = motion.shake

  let db = lincurve(mass, 0, 0.3, -40, -10, -2)
  // The original's dead zone: below -39dB it goes to -120, which is silence.
  if (db < -39) db = -120

  return {
    divIdx: Math.min(
      Math.max(Math.round(lincurve(mass, 0, 0.3, 0, DIVS.length - 1, 2)), 0),
      DIVS.length - 1,
    ),
    amp: dbamp(db),
  }
}
