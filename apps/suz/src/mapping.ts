import { lincurve, type Motion } from '@ss/motion'
import type { Mapped } from '@ss/ui'

/**
 * suz1's `~next`, in TypeScript.
 *
 *   dur = accelMassFiltered.lincurve(0, 1,   0.3,   0.02,  -3)
 *   atk = accelMassFiltered.lincurve(0, 2,   0.008, 0.002, -1)
 *   rel = accelMassFiltered.lincurve(0, 1,   1.8,   0.002, -1)
 *   play while accelMassFiltered > 0.015
 *
 * Every mapping reads the same number: how much the thing is moving. Move more
 * and it plays faster, strikes harder and stops ringing — the instrument closes
 * up as you shake it, which is the opposite of what most of these do.
 *
 * One further mapping exists in the original and does nothing: a root index
 * from the gyro, overwritten by `set(\root, 0)` on the next line. Left out.
 *
 * The octave mapping is enabled, which is a choice rather than a port. The
 * original computes `oct = gyroY.lincurve(-1, 1, 3, 6).floor` and leaves the
 * line commented out — and it could not have worked as written, because
 * `\octave` is a Pseq inside the Pbind and a Pbind key beats a Pdef.set. So it
 * shifts the sequence rather than replacing it: tilting moves the register
 * while the sixteen-step octave pattern keeps running against the nine-note
 * melody. Replacing it would have flattened the polyrhythm that is the piece.
 */
export const SILENCE_BELOW = 0.015

export function mapSuz(motion: Motion, sensitivity = 0.5): Mapped {
  
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
  const dur = lincurve(mass, 0, 1, 0.3, 0.02, -3)
  const attack = lincurve(mass, 0, 2, 0.008, 0.002, -1)
  const release = lincurve(mass, 0, 1, 1.8, 0.002, -1)

  // The original's range is 3..6 against a sequence centred on 4, which is a
  // shift of roughly minus one to plus two.
  const octaveShift = Math.round(lincurve(motion.pitch, -1, 1, -1, 2, 0))

  return {
    dur,
    level: mass,
    voice: { attack, release },
    clock: { octaveShift },
    traces: [
      { label: 'move', hint: 'rate, attack, release', value: mass * 2 - 1 },
      { label: 'tilt', hint: 'octave', value: motion.pitch },
    ],
    values: [
      ['dur', `${dur.toFixed(3)}s`],
      ['attack', `${(attack * 1000).toFixed(1)}ms`],
      ['release', `${release.toFixed(3)}s`],
      ['octave', octaveShift > 0 ? `+${octaveShift}` : String(octaveShift)],
    ],
  }
}

/**
 * suz3.sc's `~plot`, ported.
 *
 *   [m.gyroXFiltered, m.gyroYFiltered, m.gyroZFiltered]
 *
 * The plotter polls this at 33Hz and keeps fifty frames, so these are the values
 * the mapping actually feeds its curves with a second and a half of history —
 * which is the readout that makes a gesture doing nothing visible.
 */
export function plotOf(motion: Motion, sensitivity = 0.5): number[] {
  return [motion.roll, motion.pitch, motion.yaw * 2 - 1]
}

/** The series in colour order: yellow, magenta, cyan. */
export const PLOT_LABELS = ['roll', 'tilt', 'heading']
