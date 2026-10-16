import { lincurve, type Motion } from '@ss/motion'

/**
 * What the phone tells the descant, before any music is decided.
 *
 * The split follows CotF's voices: smoothed acceleration is energy, the turn rate
 * is movement through space, and an unsmoothed spike over a threshold is a hit —
 * an edge, not a level. Pose adds the two things you can hold still: which
 * octave the line is in, and how bright it is.
 */
export interface Gesture {
  /** 0..1, smoothed shake. Sets how often the descant plays, and how loud. */
  energy: number
  /** 0..1, turn rate. How far the line may climb within its octave. */
  span: number
  /** 0..1, tilt forward/back. Which octave the line plays in: low is the bass. */
  height: number
  /** 0..1, tilt left/right. The filter. */
  bright: number
  /** 0.5..2, from yaw. The drums' playback rate, kick excepted. */
  drumRate: number
  /** Set on a hard flick, cleared by the descant when it plays the accent. */
  accent: boolean
}

export const RESTING_GESTURE: Gesture = {
  energy: 0,
  span: 0,
  height: 0.5,
  bright: 0.5,
  drumRate: 1,
  accent: false,
}

/** How hard a flick has to be to accent the next note. */
export const ACCENT_THRESHOLD = 0.55

/** `0.5 / sens`, as every other page here: 0.5 is the neutral point. */
const sensScale = (sensitivity: number) => 0.5 / Math.max(0.05, sensitivity)

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1)

/**
 * The gesture for one reading.
 *
 * `accent` latches: a flick is one frame at 30Hz and the descant may not play
 * for another quarter note, so the previous value is carried until the descant
 * spends it.
 */
export function gestureFrom(motion: Motion, sensitivity: number, previous: Gesture): Gesture {
  const scale = sensScale(sensitivity)
  return {
    energy: clamp01(lincurve(motion.shake * 2.5 * scale, 0, 1.2, 0, 1, -1)),
    span: clamp01(motion.turn * scale),
    height: clamp01((motion.pitch + 1) / 2),
    bright: clamp01((motion.roll + 1) / 2),
    // Exponential, so the middle of the heading is rate 1 and each half of the
    // circle is one octave. Yaw is a compass, so it wraps: turning past north
    // jumps from 2 straight back to 0.5.
    drumRate: 0.5 * 4 ** motion.yaw,
    accent: previous.accent || motion.shakeRaw > ACCENT_THRESHOLD,
  }
}

/** The plotter: what the descant is actually being told. */
export function plotOf(motion: Motion, sensitivity = 0.5): number[] {
  const now = gestureFrom(motion, sensitivity, RESTING_GESTURE)
  return [now.energy * 2 - 1, now.span * 2 - 1, now.height * 2 - 1]
}

/** The series in colour order: yellow, magenta, cyan. */
export const PLOT_LABELS = ['shake → density, level', 'turn → range', 'tilt → octave']
