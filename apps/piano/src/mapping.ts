import { lincurve, type Motion } from '@ss/motion'

/**
 * piano1's `~next`, in TypeScript.
 *
 *   amp = accelMassFiltered.lincurve(0, 0.2, -34, -6, -1);  -120 below -29
 *   dur = accelMassFiltered.lincurve(0, 1.0, 0.5, 0.05, -1)
 *
 * One gesture, and it does two opposite things at once: shaking harder makes the
 * notes louder *and* closer together, from two notes a second to twenty. The
 * amp curve saturates at 0.2 of the travel while the dur curve uses all of it,
 * so the loudness arrives almost immediately and the speed keeps climbing after
 * it — which is why a small movement sounds like playing and a large one sounds
 * like a run.
 */

/** A maj7 arpeggio, four octaves, repeating. */
export const SCALE = [0, 4, 7, 11] as const
export const OCTAVES = [3, 4, 5, 6] as const

export const SILENCE_BELOW = 1e-5

const dbamp = (db: number) => 10 ** (db * 0.05)

export interface Piano {
  amp: number
  dur: number
}

export function pianoFrom(motion: Motion, sensitivity = 0.5): Piano {
  // accelMassFiltered runs past 1 in the original; shake is 0..1 and the dur
  // curve uses the full 0..1, so it is passed through unscaled.
  
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
  const mass = motion.shake * (0.5 / Math.max(0.05, sensitivity))

  let db = lincurve(mass, 0, 0.2, -34, -6, -1)
  // The original's dead zone. -120dB is silence, not a quiet note.
  if (db < -29) db = -120

  return {
    amp: dbamp(db),
    dur: lincurve(mass, 0, 1.0, 0.5, 0.05, -1),
  }
}

/**
 * piano1.sc's `~plot`, ported.
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
