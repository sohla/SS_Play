import type { Motion } from '../../imu/src/sensors.ts'

/**
 * `droplet.sc`'s `~next`, in TypeScript.
 *
 * The curves are the originals, verified value by value against sclang — see
 * `test/mapping.test.ts`, whose expectations are sclang's own output rather
 * than anything derived here. These mappings are the instrument; a lincurve
 * reimplemented as a lerp compiles, runs, and quietly ruins it.
 *
 * Three substitutions, because the sensor is a phone rather than an AirStick:
 *
 *   gyroYFiltered       -> pitch   same quantity, different fusion
 *   gyroEvent.x folded  -> roll    see below
 *   accelMassFiltered   -> shake   same ballistic shape, rescaled
 */

/**
 * SuperCollider's `lincurve`.
 *
 * A **negative curve bends the output toward `outMax`**, not toward the
 * minimum — the output arrives early and spends most of the input's travel near
 * its far end. Verified rather than assumed: `lincurve(0, -1, 1, 0, 1, -4)` is
 * 0.88, not 0.12. This is why droplet rains hard across most of the tilt and
 * only falls silent at the very bottom, which is a deliberate shape and the
 * opposite of what the sign suggests.
 */
export function lincurve(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
  curve = -4,
): number {
  const clipped = Math.min(Math.max(value, Math.min(inMin, inMax)), Math.max(inMin, inMax))

  // Below this SuperCollider falls back to linlin, because exp(curve) - 1
  // approaches zero and the division loses all its precision.
  if (Math.abs(curve) < 0.001) {
    return outMin + (outMax - outMin) * ((clipped - inMin) / (inMax - inMin))
  }

  const grow = Math.exp(curve)
  const position = (clipped - inMin) / (inMax - inMin)
  return outMin + (outMax - outMin) * ((1 - grow ** position) / (1 - grow))
}

/** SuperCollider's `linexp`. Exponential in the output, so it cannot cross zero. */
export function linexp(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const clipped = Math.min(Math.max(value, Math.min(inMin, inMax)), Math.max(inMin, inMax))
  return (outMax / outMin) ** ((clipped - inMin) / (inMax - inMin)) * outMin
}

/**
 * SuperCollider's `fold`: reflect back into range rather than clip.
 *
 * Unused in the final mapping and kept because the original's provenance runs
 * through it — `(gyroEvent.x / pi).fold(-0.5, 0.5) * 2` takes a full rotation
 * and reflects it onto -1..1, so rolling past a quarter turn comes back rather
 * than pinning. Our `roll` is a gravity projection, which already reflects —
 * `sin` of the roll angle peaks at 90° and returns — so the fold is inherent
 * rather than applied. That correspondence is close in character and not exact:
 * the original is linear between its reflections, this one is sinusoidal.
 */
export function fold(value: number, lo: number, hi: number): number {
  if (value >= lo && value <= hi) return value
  const span = hi - lo
  const wrapped = (((value - lo) % (2 * span)) + 2 * span) % (2 * span)
  return lo + (wrapped > span ? 2 * span - wrapped : wrapped)
}

export interface Shower {
  /** Seconds between drops. */
  dur: number
  /** What the SynthDef gates its trigger on; below SILENCE_BELOW nothing spawns. */
  level: number
  amp: number
  decay: number
  wobble: number
  room: number
  attack: number
}

/** Fixed in the original's Pbind, kept here so the value has one home. */
const ATTACK = 0.001

/**
 * Our accelerometer axes are normalised against a 12 m/s² full scale, while the
 * original scales raw AirStick readings by 0.1. Multiplying by 1.2 puts an
 * ordinary movement across most of the curve's input range instead of the first
 * tenth of it.
 *
 * The one number here that is a judgement rather than a port, so it is named.
 */
const SIDE_SCALE = 1.2

/** The original reads accelMassFiltered over roughly 0..2.5; `shake` is 0..1. */
const MASS_SCALE = 2.5

export function showerFrom(motion: Motion): Shower {
  // Movement in the plane of the screen — a flick of the wrist — rather than
  // across it.
  const side = (Math.abs(motion.accelY) + Math.abs(motion.accelZ)) * SIDE_SCALE

  // Roll sets the ceiling the wobble can reach; the flick then travels toward
  // it. Two gestures on one parameter, which is the original's idea and the
  // reason this voice is never quite static.
  const wobbleCeiling = lincurve(motion.roll, -1, 1, 0.01, 14000, -2)

  const amp = lincurve(motion.pitch, -1, 1, 0, 1, -2)

  return {
    dur: lincurve(motion.pitch, -1, 1, 0.5, 0.075),
    level: amp,
    amp,
    decay: lincurve(side, 0, 1, 0.05, 3, -1),
    wobble: lincurve(side, 0, 1, 1, wobbleCeiling, -2),
    room: lincurve(motion.shake * MASS_SCALE, 0, 2.5, 0.53, 0.95, 2),
    attack: ATTACK,
  }
}

/**
 * Below this the shower stops.
 *
 * Mirrors `if (amp < 0.21) { amp = 0 }` in the original, and the comparison
 * inside ssp_drop_clock that actually enforces it. From the curve, amp crosses
 * 0.21 at a pitch of about -0.78 — so the silence is at the bottom of the tilt,
 * not at rest. Holding the phone level rains hard.
 */
export const SILENCE_BELOW = 0.21
