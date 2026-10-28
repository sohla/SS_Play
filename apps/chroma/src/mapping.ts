import { lincurve, type Motion } from '@ss/motion'
import { LEVELS } from './phrase.ts'

/**
 * `multibeat`'s mapping, aimed at a phrase instead of a subdivision.
 *
 * One number — filtered shake — drives everything, as it does there: it picks
 * which density of the phrase is playing, and how loud. Holding still is a
 * gesture, because below the floor the rhythm stops rather than fading.
 *
 *   level = mass.lincurve(0, 1.5, 0, 2, 1).round.clip(0, 2)
 *   amp   = mass.lincurve(0, 1.0, -34, -4, -1).dbamp, silent under -33dB
 *
 * The amp range sits higher than multibeat's -40..-10 because these are drum
 * samples rather than a synth voice: at -10dB a kit sample is barely there
 * against a phone speaker. Starting values, not tuned on hardware.
 */
export const SILENCE_BELOW = 0.02

const FLOOR_DB = -33

const dbamp = (db: number) => 10 ** (db * 0.05)

export interface Chroma {
  /** Index into `LEVELS`. */
  level: number
  /** 0 when silent. */
  amp: number
}

export const RESTING: Chroma = { level: 0, amp: 0 }

export function chromaFrom(motion: Motion, sensitivity = 0.5): Chroma {
  // `0.5 / sens`, as every other page here: 0.5 is the neutral point.
  const mass = motion.shake * 2 * (0.5 / Math.max(0.05, sensitivity))
  const top = LEVELS.length - 1

  const db = lincurve(mass, 0, 1, -34, -4, -1)

  return {
    level: Math.min(Math.max(Math.round(lincurve(mass, 0, 1.5, 0, top, 1)), 0), top),
    amp: db < FLOOR_DB ? 0 : dbamp(db),
  }
}

/** `[raw, filtered, amp]`, multibeat's three series with the drone swapped for the drums. */
export function plotOf(motion: Motion, sensitivity = 0.5): number[] {
  return [motion.shakeRaw, motion.shake, chromaFrom(motion, sensitivity).amp]
}

export const PLOT_LABELS = ['move, raw', 'move, filtered', 'drum level']
