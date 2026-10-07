import { lincurve, type Motion } from '@ss/motion'

/**
 * multiBeat5's `~next`, in TypeScript.
 *
 *   idx     = accelMassFiltered.lincurve(0, 1.5, 0, divs.size - 1, 1).round
 *   amp     = accelMassFiltered.lincurve(0, 0.4, -41, -10, -1);  -90 below -40
 *   oct     = (gyroY / pi.half).lincurve(-1, 1, 4, 6, 1).asInteger
 *   ptch    = (gyroX / pi).fold(-0.5, 0.5).linlin(-0.5, 0.5, 0.94, 1.06)
 *   panBias = (gyroZ / pi).fold(-0.5, 0.5).linlin(-0.5, 0.5, -0.5, 0.5)
 *
 * Five lines, of which **three reach the sound and two do not**. Stated here
 * rather than discovered later, because the difference decides what the page
 * can do.
 *
 *   `ptch` is computed and then the line that would send it is commented out,
 *   so roll does nothing. A working note, left as one.
 *
 *   `oct` is computed and sent — and overridden. `\octave` is bound inside the
 *   Pbind as `Pseq([3, 4, 5].stutter(4), inf)`, and a Pbind's own keys are
 *   written over the prototype `Pdef.set` fills in. So the octave follows a
 *   fixed twelve-event cycle and tilt is ignored. The idiom that *does* work is
 *   the one `energy`, `divIdx` and `panBias` use: set a key the Pbind reads with
 *   `Pkey` or a `Pfunc`, never one it binds itself.
 *
 * What is left is shake, driving the subdivision and the level, and the phone's
 * heading driving a pan bias.
 */

/** Subdivisions of a half-second bar. Four, from a bar-long note to eight. */
export const DIVS = [1, 2, 4, 8] as const
export const BEAT_S = 0.5

/** `[0, 4, 7, 12, 14, 12, 7, 4] + 12`, read `keep(div)` deep. */
export const POOL = [12, 16, 19, 24, 26, 24, 19, 16] as const

/** `Pseq([3, 4, 5].stutter(4), inf)` — one value per event, not per bar. */
export const OCTAVES = [3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5] as const

/**
 * The level below which the page counts as stopped.
 *
 * Has to sit between the dead zone and the quietest real note, and those are
 * close enough together to be worth writing down:
 *
 *   dead zone   -90dB  = 3.2e-5
 *   this        -80dB  = 1.0e-4
 *   quietest    -41dB  = 8.9e-3
 *
 * A first attempt at 1e-5 was *below* the dead zone, so a page sitting still
 * reported itself as sounding. The other ported pages drop to -120dB in their
 * dead zone, where 1e-5 is safely under; this one only goes to -90.
 */
export const SILENCE_BELOW = 1e-4

const linlin = (v: number, a: number, b: number, c: number, d: number) =>
  c + ((d - c) * (Math.min(Math.max(v, a), b) - a)) / (b - a)

const dbamp = (db: number) => 10 ** (db * 0.05)

/** sclang's `fold`, which reflects at the bounds rather than clamping. */
const fold = (value: number, lo: number, hi: number) => {
  const span = hi - lo
  if (span <= 0) return lo
  const shifted = (((value - lo) % (2 * span)) + 2 * span) % (2 * span)
  return lo + (shifted > span ? 2 * span - shifted : shifted)
}

export interface Marimba {
  divIdx: number
  energy: number
  panBias: number
}

export function marimbaFrom(motion: Motion, sensitivity = 0.5): Marimba {
  // accelMassFiltered reaches ~1.5 at the top of the subdivision curve; shake is
  // 0..1 and is scaled to the same travel rather than remapped.
  
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
  const mass = motion.shake * 1.5 * (0.5 / Math.max(0.05, sensitivity))

  let db = lincurve(mass, 0, 0.4, -41, -10, -1)
  // The original's dead zone: below -40dB it drops to -90, which is silence.
  if (db < -40) db = -90

  return {
    divIdx: Math.min(
      Math.max(Math.round(lincurve(mass, 0, 1.5, 0, DIVS.length - 1, 1)), 0),
      DIVS.length - 1,
    ),
    energy: dbamp(db),
    panBias: linlin(fold(motion.yaw * 2 - 1, -0.5, 0.5), -0.5, 0.5, -0.5, 0.5),
  }
}

/**
 * multiBeat5.sc's `~plot`, ported.
 *
 *   [m.accelMass, m.accelMassFiltered, d.sensors.gyroEvent.y / pi.half]
 *
 * The plotter polls this at 33Hz and keeps fifty frames, so these are the values
 * the mapping actually feeds its curves with a second and a half of history —
 * which is the readout that makes a gesture doing nothing visible.
 */
export function plotOf(motion: Motion, sensitivity = 0.5): number[] {
  return [motion.shakeRaw, motion.shake, motion.pitch]
}

/** The series in colour order: yellow, magenta, cyan. */
export const PLOT_LABELS = ['move, raw', 'move, filtered', 'tilt']
