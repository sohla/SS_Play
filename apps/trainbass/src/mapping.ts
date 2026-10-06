import { lincurve, type Motion } from '@ss/motion'
import type { Mapped } from '@ss/ui'

/**
 * trainBass's `~next`, in TypeScript.
 *
 *   a         = accelMassFiltered.lincurve(0, 3,   0,   1,    -3);  0 below 0.03, 0.9 above
 *   filtSpeed = accelMassFiltered.lincurve(0, 2.5, 0.1, 20,    3)
 *   lfoFreq   = accelMassFiltered.lincurve(0, 2.5, 0.1, 18,   -1)
 *   filtFreq  = accelMassFiltered.lincurve(0, 2.5, 3,   1000, -3)
 *
 * One number again, but split between two instruments: the percussion's
 * highpass and the pad's two modulation rates. Moving the hand brightens the
 * drum and speeds the pad's breathing at once, which is why they sound like one
 * thing rather than two.
 *
 * `filtSpeed` and `lfoFreq` take opposite curves over the same input — 3 and
 * -1 — so the filter sweep accelerates late and the pulse accelerates early.
 * They pull apart in the middle of the gesture and meet at the ends.
 */
export const SILENCE_BELOW = 0.03

/** The figure, as the Pbind has it. */
export const NOTES = [0, 10, 5, 4, 7, 7, 2, 5, 4, 4, -2, 2, 0, 0, 0, 0].flatMap((n) => [n + 4, n + 4])
export const OCTAVES = [3, 4]
export const ROOTS = [0, -2, 0, 3]
export const STEP_S = 0.22
/** `Pseq([0.22, 0.22, Rest(0.22), 0.22, 0.22, 0.22], inf)` — the third beat is silent. */
export const REST_AT = 2
export const BAR_STEPS = 6
/** The pad's own note, which the original moves to follow a key change. */
export const PAD_NOTE = 60

export interface TrainBass {
  amp: number
  filtSpeed: number
  lfoFreq: number
  filtFreq: number
}

export function trainBassFrom(motion: Motion): TrainBass {
  const mass = motion.shake * 3

  let amp = lincurve(mass, 0, 3, 0, 1, -3)
  // The original's floor and ceiling, which turn a curve into something a hand
  // can find the ends of.
  if (amp < 0.03) amp = 0
  if (amp > 0.9) amp = 0.9

  return {
    amp,
    filtSpeed: lincurve(mass, 0, 2.5, 0.1, 20, 3),
    lfoFreq: lincurve(mass, 0, 2.5, 0.1, 18, -1),
    filtFreq: lincurve(mass, 0, 2.5, 3, 1000, -3),
  }
}

export function mapTrainBass(motion: Motion): Mapped {
  const now = trainBassFrom(motion)

  return {
    dur: STEP_S,
    level: now.amp,
    voice: {},
    held: { filtSpeed: now.filtSpeed, lfoFreq: now.lfoFreq },
    traces: [{ label: 'move', hint: 'level, filter, and the pad’s breathing', value: motion.shake * 2 - 1 }],
    values: [
      ['amp', now.amp.toFixed(3)],
      ['filtFreq', `${now.filtFreq.toFixed(0)}Hz`],
      ['filtSpeed', now.filtSpeed.toFixed(2)],
      ['lfoFreq', now.lfoFreq.toFixed(2)],
    ],
  }
}
