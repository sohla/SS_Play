import { lincurve, type Motion } from '@ss/motion'
import type { Mapped } from '@ss/ui'

/**
 * leaves' `~next`, in TypeScript.
 *
 *   a   = accelMassFiltered.lincurve(0, 3, 0.01, 1.0, -2);  0 below 0.0003
 *   pan = gyroZ.linlin(-1, 1, -0.3, 0.3)
 *   amp = a * 0.3
 *
 * That is all the original does: level and position. Every other control on the
 * voice — the grain rate, the grain length, the dust, and the crossfade between
 * three noise colours — sits at its default and is never touched.
 *
 * Which makes for a thin instrument, so the rest are mapped here. They are
 * marked as additions rather than quietly folded in: the two above are the
 * port, and the three below are a reading of what the controls were put there
 * for.
 */
/**
 * The original's dead zone, which the original can never reach.
 *
 * `lincurve(mass, 0, 3, 0.01, 1.0, -2)` returns `0.01` at its own lower bound,
 * so `a` has a floor two orders of magnitude above this threshold and the test
 * against it is unreachable. Kept at the number the source names rather than
 * raised to something that would fire, because the behaviour that produces is
 * clearly the intended one — a four-second attack on an `asr` is not how you
 * write a voice meant to stop. It is a texture that sits there and gets louder
 * when disturbed.
 *
 * So unlike every other held page, this one never reads "stopped".
 */
export const SILENCE_BELOW = 0.0003

const linlin = (v: number, a: number, b: number, c: number, d: number) =>
  c + ((d - c) * (Math.min(Math.max(v, a), b) - a)) / (b - a)

export interface Leaves {
  amp: number
  pan: number
  leafType: number
  grainRate: number
  dustiness: number
}

export function leavesFrom(motion: Motion): Leaves {
  const mass = motion.shake * 3

  let a = lincurve(mass, 0, 3, 0.01, 1.0, -2)
  if (a < 0.0003) a = 0

  return {
    amp: a * 0.3,
    pan: linlin(motion.yaw * 2 - 1, -1, 1, -0.3, 0.3),

    // Additions. Tilt crossfades pink to brown to grey — SelectX interpolates,
    // so halfway between two is a mixture rather than a choice.
    leafType: linlin(motion.pitch, -1, 1, 0, 2),
    // Turning changes how fast the grains come, which at the bottom end stops
    // sounding like a texture and starts sounding like individual events.
    grainRate: linlin(motion.turn, 0, 1, 8, 120),
    // Rolling adds the sparse impulses over the top.
    dustiness: linlin(motion.roll, -1, 1, 0, 1.2),
  }
}

const COLOURS = ['pink', 'pink–brown', 'brown', 'brown–grey', 'grey']

export function mapLeaves(motion: Motion): Mapped {
  const now = leavesFrom(motion)

  return {
    dur: 0,
    level: now.amp,
    voice: {},
    held: now as unknown as Record<string, number>,
    traces: [
      { label: 'move', hint: 'level', value: motion.shake * 2 - 1 },
      { label: 'tilt', hint: 'pink → brown → grey', value: motion.pitch },
      { label: 'turn', hint: 'grain rate', value: motion.turn * 2 - 1 },
      { label: 'roll', hint: 'dust over the top', value: motion.roll },
    ],
    values: [
      ['amp', now.amp.toFixed(4)],
      ['colour', COLOURS[Math.round((now.leafType / 2) * 4)] ?? 'pink'],
      ['grains/s', now.grainRate.toFixed(0)],
      ['dust', now.dustiness.toFixed(2)],
    ],
  }
}
