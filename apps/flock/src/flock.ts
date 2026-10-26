import type { GridEvent } from '@ss/engine'

/**
 * One flock, shared by every device, from the clock alone.
 *
 * ## Why it is not a boids simulation
 *
 * Boids are stateful: the herd at time t depends on every step before it, so two
 * phones agree only if they started together and never stalled. That is exactly
 * the property `GridConductor` was built to avoid. So the flock here is a pure
 * function of wall-clock time — `particlesAt(t)` — and a phone that joins late,
 * or comes back from a backgrounded tab, is in the same place as everyone else
 * with nothing to catch up on.
 *
 * It is made to *read* as a flock rather than to be one. Four sub-flocks wander
 * slow Lissajous paths across a world several screens wide; each particle
 * follows its flock's centre a little late, so the herd has a tail, and orbits
 * it on a stretched ellipse that breathes. Nothing here steers anything else.
 *
 * ## The hive
 *
 * The world is a torus `WORLD` units across, where one unit is the *shorter* side
 * of a screen. Each device is a window onto it at its own `slot`. Nothing is
 * exchanged, so the windows do not know where each other are — but they all look
 * at one herd, so it crosses from one screen to the next on its own timing.
 *
 * ## What the phone adds
 *
 * Only to itself. Sensing is not shared (that needs a relay and this page has
 * none), so a tilt or a shake changes how the herd behaves *inside this window*
 * and nowhere else. See `perturb`.
 */

export const WORLD = 5
export const COUNT = 480
export const FLOCKS = 4

/** Pi twice, the one constant every phase below is built from. */
const TAU = Math.PI * 2

/** Integer hash to [0, 1). Deterministic, so every device draws the same particle. */
export function hash(i: number, salt: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x7f4a7c15, 0xc2b2ae35)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/**
 * Integer seconds, so that `t mod period` is exact.
 *
 * Wall-clock seconds are ~1.7e9; a sine of that is accurate in a double, but
 * taking the remainder first keeps the argument small and costs nothing.
 */
const PERIODS: readonly (readonly [number, number, number, number])[] = [
  [71, 113, 97, 59],
  [89, 137, 61, 107],
  [103, 59, 127, 83],
  [127, 83, 73, 131],
]

/** Where a sub-flock's centre is at `tSec`, in world units. */
function centre(flock: number, tSec: number, out: Float64Array) {
  const [px, qx, py, qy] = PERIODS[flock]!
  const reach = WORLD * 0.3
  const phase = (salt: number) => hash(flock, salt) * TAU
  out[0] =
    WORLD / 2 +
    reach * (0.7 * Math.sin((TAU * (tSec % px)) / px + phase(1)) + 0.3 * Math.sin((TAU * (tSec % qx)) / qx + phase(2)))
  out[1] =
    WORLD / 2 +
    reach * (0.7 * Math.cos((TAU * (tSec % py)) / py + phase(3)) + 0.3 * Math.sin((TAU * (tSec % qy)) / qy + phase(4)))
}

interface Traits {
  flock: number
  /** Seconds this particle trails its flock's centre. */
  lag: number
  /** Orbit size, in world units. */
  radius: number
  /** Seconds per orbit — an integer, so the remainder wraps without a seam. Negative runs backwards. */
  orbit: number
  phase: number
  /** Seconds in the flock's breathing cycle where this particle peaks. */
  breath: number
}

const TRAITS: readonly Traits[] = Array.from({ length: COUNT }, (_, i) => ({
  flock: i % FLOCKS,
  lag: hash(i, 11) * 5,
  radius: 0.05 + 0.4 * hash(i, 12) ** 2,
  orbit: (12 + Math.floor(28 * hash(i, 13))) * (hash(i, 14) < 0.5 ? -1 : 1),
  phase: hash(i, 15) * TAU,
  breath: hash(i, 16) * TAU,
}))

export function flockOf(i: number): number {
  return TRAITS[i]!.flock
}

const here = new Float64Array(2)
const ahead = new Float64Array(2)

/**
 * Every particle's world position at a wall-clock instant, written as `x, y` pairs.
 *
 * Unwrapped and so possibly just outside `0..WORLD`; use `wrap` for anything
 * that compares two positions.
 */
export function particlesAt(wallMs: number, out: Float64Array) {
  const tSec = wallMs / 1000

  for (let i = 0; i < COUNT; i++) {
    const p = TRAITS[i]!
    const t = tSec - p.lag

    centre(p.flock, t, here)
    centre(p.flock, t + 0.5, ahead)

    // The flock's heading, so the orbit is stretched along the way it is going.
    const heading = Math.atan2(ahead[1]! - here[1]!, ahead[0]! - here[0]!)
    const breathing = 1 + 0.35 * Math.sin((TAU * (tSec % 9)) / 9 + p.breath)

    const angle = p.phase + (TAU * (tSec % Math.abs(p.orbit))) / p.orbit
    const along = Math.cos(angle) * p.radius * 1.8 * breathing
    const across = Math.sin(angle) * p.radius * 0.6 * breathing
    const [c, s] = [Math.cos(heading), Math.sin(heading)]

    out[i * 2] = here[0]! + along * c - across * s
    out[i * 2 + 1] = here[1]! + along * s + across * c
  }
}

/** A world offset folded into -WORLD/2 .. WORLD/2, the short way round the torus. */
export function wrap(delta: number): number {
  return delta - WORLD * Math.round(delta / WORLD)
}

/** What this one device is doing to its own window. Everything 0 is "nothing". */
export interface Local {
  /** Where the gravity well sits, in view units from the window's centre. */
  wellX: number
  wellY: number
  /** 0..1: how strongly the well pulls. Zero when the phone is level. */
  pull: number
  /** 0..1: scatter from the centre. Decays on its own upstream. */
  shake: number
}

export const AT_REST: Local = { wellX: 0, wellY: 0, pull: 0, shake: 0 }

const WELL = 0.35
const BLAST = 0.5

/**
 * Bend one particle's offset from the window's centre.
 *
 * Tilt is a gravity well: particles near it are drawn in, so tipping the phone
 * *herds* the flock rather than sliding the whole view, and the well's reach is
 * a fraction of a screen so it feels like a hand in water. Shake is the opposite
 * impulse, pushing outward from the centre. Both fall off with distance, and
 * both return the input unchanged at rest — the shared flock is untouched until
 * someone touches it.
 */
export function perturb(dx: number, dy: number, local: Local, out: Float64Array) {
  let x = dx
  let y = dy

  if (local.pull > 0) {
    const gx = local.wellX - x
    const gy = local.wellY - y
    const reach = Math.exp(-(gx * gx + gy * gy) / (2 * WELL * WELL))
    x += gx * reach * local.pull * 0.85
    y += gy * reach * local.pull * 0.85
  }

  if (local.shake > 0) {
    const r = Math.hypot(x, y) || 1e-6
    const push = local.shake * 0.8 * Math.exp(-(r * r) / (2 * BLAST * BLAST))
    x += (x / r) * push
    y += (y / r) * push
  }

  out[0] = x
  out[1] = y
}

/** The window, in view units, centred on `slot`. One unit is the screen's shorter side. */
export interface View {
  cx: number
  cy: number
  halfW: number
  halfH: number
}

// D minor pentatonic over three octaves. Chosen because no two notes in it
// clash, so a cloud of grains landing at once stays a chord rather than a smear.
const SEMITONES = [0, 3, 5, 7, 10] as const
const ROOT_HZ = 146.83
const DEGREES = SEMITONES.length * 3

export function pitchOf(height: number): number {
  const degree = Math.min(DEGREES - 1, Math.max(0, Math.floor(height * DEGREES)))
  const semitones = 12 * Math.floor(degree / SEMITONES.length) + SEMITONES[degree % SEMITONES.length]!
  return ROOT_HZ * 2 ** (semitones / 12)
}

/** The most grains one step may send. A phone has a limit and so does the ear. */
export const VOICE_CAP = 8

const world = new Float64Array(COUNT * 2)
const bent = new Float64Array(2)

/**
 * The grains for one grid step: a pure function of the step, the window and the
 * local state, so it is the same on every device that shares the window.
 *
 * Each visible particle fires on a step with a probability set so that the
 * *total* is a few per step however crowded the window is — a dense herd gets
 * thicker texture, not more voices. Height in the window sets pitch, so the
 * flock's shape is audible as a contour; horizontal position sets pan.
 */
export function grainsForStep(
  step: number,
  stepMs: number,
  view: View,
  local: Local,
): readonly GridEvent[] {
  particlesAt(step * stepMs, world)

  const seen: { i: number; x: number; y: number }[] = []
  for (let i = 0; i < COUNT; i++) {
    perturb(wrap(world[i * 2]! - view.cx), wrap(world[i * 2 + 1]! - view.cy), local, bent)
    if (Math.abs(bent[0]!) <= view.halfW && Math.abs(bent[1]!) <= view.halfH) {
      seen.push({ i, x: bent[0]!, y: bent[1]! })
    }
  }
  if (seen.length === 0) return []

  const target = 2 + 5 * local.shake
  const chance = Math.min(1, target / seen.length)

  const events: GridEvent[] = []
  for (const p of seen) {
    if (hash(p.i, step) >= chance) continue
    const height = 1 - (p.y + view.halfH) / (2 * view.halfH)
    events.push({
      def: 'ssp_sine',
      controls: {
        freq: pitchOf(height),
        amp: (0.1 + 0.06 * hash(p.i, 21)) / Math.sqrt(Math.max(3, Math.min(seen.length, VOICE_CAP))),
        pan: Math.max(-1, Math.min(1, p.x / view.halfW)),
        attack: 0.03,
        decay: 0.1,
        susLevel: 0.6,
        release: 0.5,
      },
      sustain: 0.15,
    })
    if (events.length === VOICE_CAP) break
  }
  return events
}
