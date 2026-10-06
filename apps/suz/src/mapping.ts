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

export function mapSuz(motion: Motion): Mapped {
  const mass = motion.shake
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
