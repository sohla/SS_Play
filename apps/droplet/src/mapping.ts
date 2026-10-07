import { lincurve, type Motion } from '@ss/motion'

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
 * What `~plot` draws in AirKit, which is the three inputs the mapping reads
 * rather than the orientation itself:
 *
 *   (gyroEvent.x / pi).fold(-0.5, 0.5) * 2
 *   gyroYFiltered
 *   (|accelEvent.y| + |accelEvent.z|) * 0.1
 *
 * Worth showing in preference to roll/pitch/yaw: these are the numbers the
 * curves are actually fed, so a gesture that does nothing is visible here and
 * invisible in the raw angles.
 */
export interface Plot {
  /** Roll, as the original's folded gyro x. Sets the wobble ceiling. */
  gyroX: number
  /** Tilt, as the original's gyroYFiltered. Sets rate and level. */
  gyroY: number
  /** Movement in the plane of the screen. Sets tail length and wobble travel. */
  side: number
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

/**
 * AirKit's sensitivity, applied the way its personalities apply it — scaling the
 * input span of every curve, which is the same as scaling the input.
 *
 * `droplet.sc` has no `sens` of its own, so this is an addition rather than a
 * port. It goes on the two acceleration-derived inputs and not on the
 * orientation ones, which is a line worth drawing: AirKit only ever scales a
 * *unipolar* span (`lincurve(v, 0, TOP * sens, …)`), and a tilt here runs -1..1.
 * Scaling a bipolar span has no obvious meaning, and a tilt of thirty degrees is
 * thirty degrees whatever the knob says — orientation is absolute in a way that
 * a flick is not.
 *
 * `0.5 / sens`, not `1 / sens`: MASS_SCALE is already the effective bound, so
 * AirKit's 0.5 default has to be the neutral point or the page would become
 * twice as hot as the thing it was ported from.
 */
const sensScale = (sensitivity: number) => 0.5 / Math.max(0.05, sensitivity)

/** The three traces, before any curve is applied to them. */
export function plotFrom(motion: Motion): Plot {
  return {
    gyroX: motion.roll,
    // Negated against the raw pitch so that standing the phone upright is the
    // silent end. Held flat, like a bowl, it plays; stood up, it stops. The
    // original runs the other way because an AirStick is not a thing you look
    // at while you play it.
    gyroY: -motion.pitch,
    side: (Math.abs(motion.accelY) + Math.abs(motion.accelZ)) * SIDE_SCALE,
  }
}

/**
 * droplet.sc's `~plot`, as the plotter wants it.
 *
 *   [(gyroX / pi).fold(-0.5, 0.5) * 2, gyroYFiltered,
 *    (accelY.abs + accelZ.abs) * 0.1]
 *
 * Same three values `plotFrom` already returns — this is only the order AirKit
 * draws them in, so yellow is the folded roll, magenta the tilt and cyan the
 * movement in the plane of the screen.
 */
export function plotOf(motion: Motion): number[] {
  const plot = plotFrom(motion)
  return [plot.gyroX, plot.gyroY, plot.side]
}

/** The series in colour order: yellow, magenta, cyan. */
export const PLOT_LABELS = ['roll, folded', 'tilt', 'side movement']

export function showerFrom(motion: Motion, sensitivity = 0.5): Shower {
  const plot = plotFrom(motion)

  // Roll sets the ceiling the wobble can reach; the flick then travels toward
  // it. Two gestures on one parameter, which is the original's idea and the
  // reason this voice is never quite static.
  const wobbleCeiling = lincurve(plot.gyroX, -1, 1, 0.01, 14000, -2)

  const amp = lincurve(plot.gyroY, -1, 1, 0, 1, -2)

  // The flick, scaled. Both of the curves it feeds are 0..1 spans, so this is
  // the shape AirKit's sensitivity has.
  const side = plot.side * sensScale(sensitivity)

  return {
    dur: lincurve(plot.gyroY, -1, 1, 0.5, 0.075),
    level: amp,
    amp,
    decay: lincurve(side, 0, 1, 0.05, 3, -1),
    wobble: lincurve(side, 0, 1, 1, wobbleCeiling, -2),
    room: lincurve(motion.shake * MASS_SCALE * sensScale(sensitivity), 0, 2.5, 0.53, 0.95, 2),
    attack: ATTACK,
  }
}

/**
 * Below this the shower stops.
 *
 * Mirrors `if (amp < 0.21) { amp = 0 }` in the original, and the comparison
 * inside ssp_drop_clock that actually enforces it. From the curve, amp crosses
 * 0.21 at a gyroY of about -0.78 — which with the axis flipped means the phone
 * has to be nearly upright before it stops. Held flat it plays hard.
 */
export const SILENCE_BELOW = 0.21
