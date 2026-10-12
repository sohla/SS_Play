import type { GridEvent } from '@ss/engine'

/**
 * `sync`: the same rhythm on every device, from the clock alone.
 *
 * ## What it is for
 *
 * Measuring how well devices agree. Open it on two phones and they should play
 * one rhythm, not two — and where they do not, the page's job is to say which
 * of the three possible reasons it is:
 *
 * 1. **the clocks disagree** — read the step counters against each other
 * 2. **the output latency differs** — read the latency figures
 * 3. **a main thread stalled** — read the skipped count
 *
 * Those three are indistinguishable by ear and the page separates them, because
 * "it sounds a bit off" is not a measurement.
 *
 * ## How the sync works
 *
 * There is no coordination at all. No master, no server tick, no handshake.
 * Every device computes `floor(wallClock / stepMs)` and plays whatever the
 * pattern says for that step index, where the grid is anchored at the **Unix
 * epoch** — so the same instant gives the same index everywhere, and two
 * devices that agree about the time agree about the beat.
 *
 * `GridConductor` does the scheduling; see its notes for why this is a third
 * mechanism rather than a mode of the other two.
 *
 * ## The numbers
 *
 * 120bpm, sixteenth-note grid: **125ms per step, 16 steps to the bar, a
 * two-second bar.** Chosen so the bar divides a second evenly, which means bars
 * land on whole-second boundaries of wall-clock time — a bar boundary is a
 * round number, so `00.000` and `02.000` are downbeats on every device and the
 * grid is legible against any other clock you happen to be holding.
 */

/** 120bpm in sixteenths. A bar is exactly two seconds. */
export const STEP_MS = 125
export const STEPS_PER_BAR = 16
export const BAR_MS = STEP_MS * STEPS_PER_BAR

/**
 * Three samples, named rather than discovered.
 *
 * The shared store holds twelve kit samples and `/kit/` loads all of them. This
 * needs a kick, a snare and a hat, and nothing else: about 1.3 seconds of mono
 * audio, roughly 0.25MB decoded, against the ~3.7MB a phone will take. A sync
 * test should not be able to fail because it ran out of memory.
 */
export const KICK = 'kit_bdrum_yamaha.flac'
export const SNARE = 'kit_slap_1.flac'
export const HAT = 'kit_swis_1.flac'
export const LIBRARY = [KICK, SNARE, HAT] as const

/** Which buffer each voice landed in, once the set has loaded. */
export interface Drums {
  kick: number
  snare: number
  hat: number
}

/**
 * Deliberately the most obvious rhythm there is.
 *
 * Four on the floor, snare on two and four, hat on every offbeat eighth. The
 * point is not the pattern — it is that a listener can tell *instantly* whether
 * two devices are together, and a flam of a few tens of milliseconds on a kick
 * is about the most audible error a rhythm can have. Anything syncopated would
 * hide exactly what is being measured.
 *
 * Indexed by position in the bar, from an **absolute** step, so this is a pure
 * function of wall-clock time. No state, nothing to start, nothing to drift.
 */
export function eventsForStep(step: number, drums: Drums | null): readonly GridEvent[] {
  if (!drums) return []

  const inBar = ((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR
  const events: GridEvent[] = []

  // Quarter notes: steps 0, 4, 8, 12.
  if (inBar % 4 === 0) events.push(hit(drums.kick, 0.9, 0))
  // Backbeat: steps 4 and 12, the second and fourth quarters.
  if (inBar === 4 || inBar === 12) events.push(hit(drums.snare, 0.7, 0))
  // Offbeat eighths: steps 2, 6, 10, 14.
  if (inBar % 4 === 2) events.push(hit(drums.hat, 0.45, 0.35))

  return events
}

/**
 * One drum hit.
 *
 * `ssp_kit` is an adsr with a gate, so a one-shot has to be released or the node
 * lives until `maxNodes` runs out. 0.25s is longer than any of these samples and
 * `doneAction` frees it either way.
 *
 * `cutoff` is left at the def's own floor: the high-pass is there for the gesture
 * pages to sweep and this page has no gesture, so sweeping it would be a
 * variable in an experiment that is supposed to have one.
 */
function hit(bufnum: number, amp: number, pan: number): GridEvent {
  return {
    def: 'ssp_kit',
    controls: { bufnum, amp, pan, rate: 1, cutoff: 20, release: 0.02 },
    sustain: 0.25,
  }
}

/** The position of a step within its bar, 0..15. */
export function stepInBar(step: number): number {
  return ((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR
}

/** The absolute bar index a step belongs to. */
export function barOf(step: number): number {
  return Math.floor(step / STEPS_PER_BAR)
}

/**
 * Which beat of the bar a step is on, 1..4, or null between beats.
 *
 * For the flashing indicator. Two phones side by side flashing together is a
 * faster read than two step counters, and it works from across a room.
 */
export function beatOf(step: number): number | null {
  const inBar = stepInBar(step)
  return inBar % 4 === 0 ? inBar / 4 + 1 : null
}
