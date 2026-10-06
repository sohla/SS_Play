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
 * Two further mappings exist in the original and do nothing: a root index from
 * the gyro, and an octave — the first is overwritten by `set(\root, 0)` on the
 * next line and the second is commented out. Ported as written.
 */
export const SILENCE_BELOW = 0.015

export function mapSuz(motion: Motion): Mapped {
  const mass = motion.shake
  const dur = lincurve(mass, 0, 1, 0.3, 0.02, -3)
  const attack = lincurve(mass, 0, 2, 0.008, 0.002, -1)
  const release = lincurve(mass, 0, 1, 1.8, 0.002, -1)

  return {
    dur,
    level: mass,
    voice: { attack, release },
    traces: [
      { label: 'move', hint: 'rate, attack, release', value: mass * 2 - 1 },
      { label: 'tilt', hint: 'unused by this personality', value: motion.pitch },
    ],
    values: [
      ['dur', `${dur.toFixed(3)}s`],
      ['attack', `${(attack * 1000).toFixed(1)}ms`],
      ['release', `${release.toFixed(3)}s`],
      ['move', mass.toFixed(3)],
    ],
  }
}
