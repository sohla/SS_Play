import { lincurve, type Motion } from '@ss/motion'

/**
 * Three layers on one clock: a kit, a moog bass and a piano melody.
 *
 * Not a port. The mechanisms are AirKit's and are named where they are used; the
 * note material, the progression and the layering are new.
 *
 * The two gestures do different jobs, which is the whole shape of it:
 *
 *   **Rotation is smooth.** Turning the phone widens the pitch set and opens the
 *   bass filter — continuous, reversible, and nothing lands on a beat. You can
 *   sit anywhere in it.
 *
 *   **Acceleration is sharp.** Shaking picks the subdivision, so the rhythm steps
 *   between whole numbers rather than sliding; and a hard flick shifts the root,
 *   once per bar at most. Both are events you commit to.
 *
 * The borrowed mechanisms:
 *
 *   `arialBass.sc` rotates a degree list and publishes `m.com.root`, gated on
 *   movement and rate-limited by `TempoClock.beats > lastTime + 0.35`. The root
 *   here shifts the same way — on a threshold, with a floor on how often.
 *
 *   `circusChoir1.sc` has `range = accelMassFiltered.lincurve(0, 2.0 * sens, 1,
 *   notes.size, -2)`, which widens the pool as you move. Here it is rotation that
 *   widens it, because that is the gesture you can hold.
 *
 *   `multiBeat4.sc` selects a subdivision with `Pswitch(divs, Pkey(\divIdx))`,
 *   which is where the three layers get their rhythm.
 */

/** Two seconds. Every layer's step divides it, and divides every other layer's. */
export const BAR_S = 2.0

/**
 * The pitch set, in the order it opens up.
 *
 * Natural minor, but ordered by how much it commits to rather than by pitch:
 * root, fifth and minor third first, then the seventh, the fourth, the second and
 * the minor sixth. Widening never introduces a note that argues with what is
 * already sounding — it just gets less bare.
 *
 * So at the narrow end three notes over the bass's root and fifth is almost a
 * drone, and at the wide end it is the whole mode.
 */
export const DEGREES = [0, 7, 3, 10, 5, 2, 8] as const

/** Narrowest and widest the melody's pool gets. */
export const POOL_MIN = 3

/**
 * Where the root goes, as degrees of the tonic: i, iv, VI, III.
 *
 * All diatonic in the natural minor above, so a shift never leaves the mode —
 * only the centre of it moves. The melody and the bass both read it, so they
 * cannot disagree about where home is.
 */
export const ROOTS = [0, 5, 8, 3] as const

/** MIDI of the tonic. The bass sits an octave and a half below the melody. */
export const TONIC = 45
export const BASS_OCTAVE = -12
export const MELODY_OCTAVE = 24

/** Subdivisions of the bar, per layer. Each divides the one above it. */
export const KIT_DIVS = [2, 4, 8] as const
export const BASS_DIVS = [1, 2] as const
export const MELODY_DIVS = [4, 8] as const

export const SILENCE_BELOW = 1e-4

/**
 * How hard a flick has to be to move the root, and how often it may.
 *
 * `arialBass` uses `move > 0.1` with a 0.35-beat floor. The threshold here is
 * higher and the floor is a whole bar, because a root that moves on every
 * knock stops being a root.
 */
export const ROOT_THRESHOLD = 0.55
export const ROOT_FLOOR_S = BAR_S

const dbamp = (db: number) => 10 ** (db * 0.05)

const linlin = (v: number, a: number, b: number, c: number, d: number) =>
  c + ((d - c) * (Math.min(Math.max(v, a), b) - a)) / (b - a)

/** `0.5 / sens`, as every other page here: 0.5 is the neutral point. */
const sensScale = (sensitivity: number) => 0.5 / Math.max(0.05, sensitivity)

export interface Combo {
  /** Which subdivision each layer is on, as an index. */
  kitDiv: number
  bassDiv: number
  melodyDiv: number
  /** How many of DEGREES the melody may use. Rotation, so smooth. */
  pool: number
  /** Shared level: all three layers fade together. */
  level: number
  /** Opened by rotation, not by shaking. */
  filterFreq: number
  /** The melody's brightness, from roll. */
  bright: number
  /** True on the frame a flick crosses the threshold. The page rate-limits it. */
  wantsRootShift: boolean
}

export function comboFrom(motion: Motion, sensitivity = 0.5): Combo {
  const mass = motion.shake * 2.5 * sensScale(sensitivity)

  let db = lincurve(mass, 0, 1.2, -40, -8, -1)
  if (db < -36) db = -120

  // Rotation: the two things you hold rather than strike.
  const spin = motion.turn * sensScale(sensitivity)

  return {
    // Acceleration picks the rhythm. Rounded, so it steps between subdivisions
    // instead of sliding between them — which is the difference between a figure
    // changing gear and a tempo drifting.
    kitDiv: Math.min(
      Math.max(Math.round(lincurve(mass, 0, 1.5, 0, KIT_DIVS.length - 1, 1)), 0),
      KIT_DIVS.length - 1,
    ),
    bassDiv: Math.min(
      Math.max(Math.round(lincurve(mass, 0, 2.0, 0, BASS_DIVS.length - 1, 1)), 0),
      BASS_DIVS.length - 1,
    ),
    melodyDiv: Math.min(
      Math.max(Math.round(lincurve(mass, 0, 1.0, 0, MELODY_DIVS.length - 1, 1)), 0),
      MELODY_DIVS.length - 1,
    ),

    // Rotation widens the pool, and this one is *not* rounded hard against a
    // step — it is a count, so it has to be an integer, but it moves one note at
    // a time across the whole travel rather than jumping in thirds.
    pool: Math.min(
      Math.max(Math.round(linlin(spin, 0, 1, POOL_MIN, DEGREES.length)), POOL_MIN),
      DEGREES.length,
    ),

    level: dbamp(db),
    filterFreq: lincurve(spin, 0, 1, 180, 4200, 2),
    bright: linlin(motion.roll, -1, 1, 1200, 9000),
    wantsRootShift: motion.shakeRaw > ROOT_THRESHOLD,
  }
}

/**
 * The plot: what the three layers are actually being told.
 *
 * Rotation and acceleration side by side is the point — the brief is that one is
 * smooth and one is sharp, and the two traces make that visible. The third is the
 * pool width, which is the thing you are steering.
 */
export function plotOf(motion: Motion, sensitivity = 0.5): number[] {
  const now = comboFrom(motion, sensitivity)
  return [
    motion.turn * 2 - 1,
    motion.shakeRaw * 2 - 1,
    (now.pool - POOL_MIN) / (DEGREES.length - POOL_MIN) * 2 - 1,
  ]
}

/** The series in colour order: yellow, magenta, cyan. */
export const PLOT_LABELS = ['rotation → pool, filter', 'acceleration → rhythm, root', 'pool width']
