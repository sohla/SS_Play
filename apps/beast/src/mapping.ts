import { lincurve, linexp, type Motion } from '@ss/motion'
import type { Mapped } from '@ss/ui'

/**
 * movingBeast's `~next`, in TypeScript. The richest of the ported mappings:
 * seven computed values, five of them reaching into the voice.
 *
 *   dur   = accelMassFiltered.lincurve(0,   2.5, 0.4,  0.1, -1)
 *   amp   = accelMassFiltered.lincurve(0,   2.0, -40, -20,  -2).dbamp
 *   ffreq = rrateMassFiltered.linexp(0,     2.5, 180,  900)
 *   rel   = rrateMassFiltered.lincurve(0,   2.5, 0.2,  3.2, -2)
 *   fb    = gyroY.lincurve(-1, 1, 0.1, 2.0, -1)
 *   harm  = gyroZ.fold(-0.5, 0.5).linlin(-0.5, 0.5, 1, 3)
 *   growl = gyroX.fold(-0.5, 0.5).lincurve(-0.5, 0.5, 1, 4, 2)
 *
 * Shaking it speeds the figure up and makes it louder; turning it opens the
 * filter and lengthens the release; tilting changes the timbre. Movement and
 * orientation do different jobs, which is the shape worth keeping.
 */
export const SILENCE_BELOW = 0.01

/** SuperCollider's `dbamp`. */
const dbamp = (db: number) => 10 ** (db * 0.05)

/** `linlin`, which lincurve falls back to at curve zero. */
const linlin = (v: number, a: number, b: number, c: number, d: number) =>
  c + ((d - c) * (Math.min(Math.max(v, a), b) - a)) / (b - a)

export function mapBeast(motion: Motion, sensitivity = 0.5): Mapped {
  const turnRate = motion.turn
  
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
  const mass = motion.shake * 2.5 * (0.5 / Math.max(0.05, sensitivity))
  const rrate = turnRate * 2.5

  const dur = lincurve(mass, 0, 2.5, 0.4, 0.1, -1)
  const amp = dbamp(lincurve(mass, 0, 2, -40, -20, -2))
  const ffreq = linexp(rrate, 0, 2.5, 180, 900)
  const rel = lincurve(rrate, 0, 2.5, 0.2, 3.2, -2)

  // The original folds a raw gyro angle into ±0.5 before mapping. Our roll and
  // pitch come from gravity, which already reflects at the quarter turns, so
  // the fold is inherent — see pose.ts.
  const fbDepth = lincurve(motion.pitch, -1, 1, 0.1, 2.0, -1)
  const harm = linlin(motion.yaw * 2 - 1, -1, 1, 1, 3)
  const growl = lincurve(motion.roll, -1, 1, 1, 4, 2)

  return {
    dur,
    level: mass,
    voice: { amp, ffreq, rel, fbDepth, harm, growl },
    traces: [
      { label: 'move', hint: 'rate, level', value: motion.shake * 2 - 1 },
      { label: 'turn', hint: 'filter, release', value: turnRate * 2 - 1 },
      { label: 'tilt', hint: 'feedback depth', value: motion.pitch },
      { label: 'roll', hint: 'growl', value: motion.roll },
    ],
    values: [
      ['dur', `${dur.toFixed(3)}s`],
      ['amp', amp.toFixed(3)],
      ['ffreq', `${ffreq.toFixed(0)}Hz`],
      ['rel', `${rel.toFixed(2)}s`],
      ['fbDepth', fbDepth.toFixed(2)],
      ['harm', harm.toFixed(2)],
      ['growl', growl.toFixed(2)],
    ],
  }
}

/**
 * movingBeast.sc's `~plot`, ported.
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
