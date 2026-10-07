import { lincurve, linexp, type Motion } from '@ss/motion'
import type { Mapped } from '@ss/ui'

/**
 * trainMelody2's `~next`, in TypeScript.
 *
 *   oct    = gyroYFiltered.linlin(-1, 1, 6, 3).floor
 *   envRel = accelMassFiltered.lincurve(0, 1,   0.1,  2.6, 2)
 *   envDec = accelMassFiltered.lincurve(0, 1,   0.05, 0.2, -2)
 *   amp    = accelMassFiltered.lincurve(0, 2.5, 0.001, 0.1, -2) * 2, 0 below 0.02
 *   ff     = gyroX.fold(-0.5, 0.5).linexp(-1, 1, 50, 14000)
 *   rf     = gyroX.fold(-0.5, 0.5).linexp(-1, 1, 0.9, 0.2)
 *
 * Note the octave range runs 6 to 3, not 3 to 6: tilting *up* takes it down.
 * Easy to read as a typo and it is not — the melody climbs as the hand drops,
 * which is the opposite of the obvious mapping and much better to play.
 *
 * The filter and its resonance both come from roll, moving against each other:
 * opening the filter closes the resonance, so one gesture sweeps from a dull
 * ring to a bright flat tone rather than to something merely louder.
 *
 * This voice reads a root the quartet's bass publishes. There is no quartet
 * here, so it sits at the 5 the original adds to it.
 */
export const SILENCE_BELOW = 0.02

/** `dur = 0.22 / 2` at the top of the original, and never changed. */
export const STEP_S = 0.11
export const NOTES = [11, 13, 9, 6, -1]
export const ROOT = 5

export interface TrainMelody {
  octave: number
  envRel: number
  envDec: number
  amp: number
  filtFreq: number
  filtRes: number
}

export function trainMelodyFrom(motion: Motion, sensitivity = 0.5): TrainMelody {
  
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

  let amp = lincurve(mass, 0, 2.5, 0.001, 0.1, -2) * 2
  if (amp < 0.02) amp = 0

  return {
    octave: Math.floor(lincurve(motion.pitch, -1, 1, 6, 3, 0)),
    envRel: lincurve(mass, 0, 1, 0.1, 2.6, 2),
    envDec: lincurve(mass, 0, 1, 0.05, 0.2, -2),
    amp,
    filtFreq: linexp((motion.roll + 1) / 2, 0, 1, 50, 14000),
    filtRes: linexp((motion.roll + 1) / 2, 0, 1, 0.9, 0.2),
  }
}

export function mapTrainMelody(motion: Motion, sensitivity = 0.5): Mapped {
  const now = trainMelodyFrom(motion, sensitivity)

  return {
    dur: STEP_S,
    level: now.amp,
    voice: {},
    traces: [
      { label: 'move', hint: 'level, decay, release', value: motion.shake * 2 - 1 },
      { label: 'tilt', hint: 'octave — down raises it', value: motion.pitch },
      { label: 'roll', hint: 'filter against resonance', value: motion.roll },
    ],
    values: [
      ['octave', String(now.octave)],
      ['amp', now.amp.toFixed(4)],
      ['filtFreq', `${now.filtFreq.toFixed(0)}Hz`],
      ['filtRes', now.filtRes.toFixed(3)],
      ['release', `${now.envRel.toFixed(2)}s`],
    ],
  }
}

/**
 * trainMelody2.sc's `~plot`, ported.
 *
 *   [m.gyroYFiltered.lincurve(-1.0, 1.0, 0.0, 1.0, -2)]
 *
 * The plotter polls this at 33Hz and keeps fifty frames, so these are the values
 * the mapping actually feeds its curves with a second and a half of history —
 * which is the readout that makes a gesture doing nothing visible.
 */
export function plotOf(motion: Motion, sensitivity = 0.5): number[] {
  return [lincurve(motion.pitch, -1, 1, 0, 1, -2)]
}

/** The series in colour order: yellow, magenta, cyan. */
export const PLOT_LABELS = ['tilt, curved']
