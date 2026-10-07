import { lincurve, linexp, type Motion } from '@ss/motion'
import type { Mapped } from '@ss/ui'

/**
 * miniMoog's `~next`, in TypeScript.
 *
 *   dur = 0.2  (fixed)
 *   amp = accelMassFiltered.lincurve(0, 1.5, -15,  -1,     -1).dbamp
 *   atk = accelMassFiltered.lincurve(0, 1.5, 0.1,   0.0001, -3)
 *   rel = accelMassFiltered.lincurve(0, 2.5, 0.01,  1.0,    -1)
 *   ff  = rrateMassFiltered.linexp(0, 0.2,  60,   15000)
 *
 * Shaking it makes it louder and sharpens the attack to nothing while
 * lengthening the release — so the notes get shorter at the front and longer at
 * the back at once. Turning it opens the filter, and over a very small range:
 * a fifth of the rotation sensor's travel covers eight octaves of cutoff, which
 * is why it responds to a flick rather than a sweep.
 *
 * `set(\rel, ...)` in the original names a control the SynthDef does not have —
 * it is `release`. Ported to the control that exists.
 */
export const SILENCE_BELOW = 0.01

const dbamp = (db: number) => 10 ** (db * 0.05)

export function mapMoog(motion: Motion, sensitivity = 0.5): Mapped {
  
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
  const rrate = motion.turn * 0.2

  const amp = dbamp(lincurve(mass, 0, 1.5, -15, -1, -1))
  const attack = lincurve(mass, 0, 1.5, 0.1, 0.0001, -3)
  const release = lincurve(mass, 0, 2.5, 0.01, 1.0, -1)
  const filterFreq = linexp(rrate, 0, 0.2, 60, 15000)

  return {
    // Fixed at 0.2 in the original.
    dur: 0.2,
    level: mass,
    voice: { amp, attack, release, filterFreq },
    traces: [
      { label: 'move', hint: 'level, attack, release', value: motion.shake * 2 - 1 },
      { label: 'turn', hint: 'filter — a flick, not a sweep', value: motion.turn * 2 - 1 },
    ],
    values: [
      ['amp', amp.toFixed(3)],
      ['attack', `${(attack * 1000).toFixed(2)}ms`],
      ['release', `${release.toFixed(3)}s`],
      ['ffreq', `${filterFreq.toFixed(0)}Hz`],
    ],
  }
}

/**
 * miniMoog.sc's `~plot`, ported.
 *
 *   [m.rrateMass, m.rrateMassFiltered.linlin(0, 0.2, 0, 1)]
 *
 * The plotter polls this at 33Hz and keeps fifty frames, so these are the values
 * the mapping actually feeds its curves with a second and a half of history —
 * which is the readout that makes a gesture doing nothing visible.
 */
export function plotOf(motion: Motion, sensitivity = 0.5): number[] {
  // `linlin(0, 0.2, 0, 1)` is a fivefold gain, clamped — the turn rate this page
  // reads lives in the bottom fifth of its range, and the raw trace beside it is
  // there to show how little of the travel is actually in use.
  return [motion.turnRaw, Math.min(1, Math.max(0, motion.turn / 0.2))]
}

/** The series in colour order: yellow, magenta, cyan. */
export const PLOT_LABELS = ['turn, raw', 'turn, filtered and scaled']
