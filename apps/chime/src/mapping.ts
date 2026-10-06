import { linexp, type Motion } from '@ss/motion'
import type { Mapped } from '@ss/ui'

/**
 * wingChimes3's `~next`, in TypeScript.
 *
 *   dur = 0.3  (fixed)
 *   rq  = accelMassFiltered.linexp(0, 4, 0.1,  0.0005)
 *   amp = accelMassFiltered.linexp(0, 4, 0.05, 2)
 *   play while accelMass > 0.1
 *
 * Both mappings read the same number and pull in opposite directions: moving
 * more makes it louder and narrows the filter toward a pure tone, so the
 * instrument goes from a hiss to a ringing bar as you shake it.
 *
 * `dur` is fixed in the original. It is driven here from tilt, because a page
 * with one gesture is a page where most of the phone does nothing.
 */
export const SILENCE_BELOW = 0.1

export function mapChime(motion: Motion): Mapped {
  const mass = motion.shake * 4
  const rq = linexp(mass, 0, 4, 0.1, 0.0005)
  const amp = linexp(mass, 0, 4, 0.05, 2)

  // Not in the original, which fixes dur at 0.3.
  const dur = linexp((motion.pitch + 1) / 2, 0, 1, 0.8, 0.1)

  return {
    dur,
    level: motion.shake,
    voice: { rq, amp },
    traces: [
      { label: 'move', hint: 'level, and how pure the tone', value: motion.shake * 2 - 1 },
      { label: 'tilt', hint: 'how often they strike', value: motion.pitch },
    ],
    values: [
      ['rq', rq.toFixed(5)],
      ['amp', amp.toFixed(3)],
      ['dur', `${dur.toFixed(3)}s`],
    ],
  }
}
