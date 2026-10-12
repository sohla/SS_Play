import { describe, expect, it } from 'vitest'
import { NTP_EPOCH_OFFSET, stepAt, stepStartMs } from '../src/grid-conductor.ts'

/**
 * The grid maths, which is the only part that has to be identical on two
 * devices that have never spoken to each other.
 *
 * Everything else about `GridConductor` — the timer, the lookahead, the OSC
 * encoding — can differ between devices without the rhythm drifting. These
 * three functions cannot: if two phones disagree about which step an instant
 * belongs to, they play different bars and no amount of scheduling accuracy
 * helps. So they are pure, and asserted here rather than through a browser.
 */

const STEP = 125

describe('the grid is the same everywhere because it is anchored to the epoch', () => {
  it('derives the step from the instant alone, with no state', () => {
    // Not "since start" — since 1970. Two devices starting hours apart land on
    // the same index for the same moment, which is the whole mechanism.
    expect(stepAt(0, STEP)).toBe(0)
    expect(stepAt(124.999, STEP)).toBe(0)
    expect(stepAt(125, STEP)).toBe(1)
    expect(stepAt(2000, STEP)).toBe(16)
  })

  it('round-trips a step to its start and back', () => {
    for (const step of [0, 1, 15, 16, 1_000_000, 14_000_000_000]) {
      expect(stepAt(stepStartMs(step, STEP), STEP)).toBe(step)
    }
  })

  it('holds exactly at a real wall-clock magnitude', () => {
    // ~1.76e12 ms since the epoch, so ~1.4e10 steps. Both are integers well
    // inside a double's 2^53, which is why this can be plain arithmetic rather
    // than something careful — worth pinning, because the day it stops being
    // true the rhythm would quietly granulate.
    const now = 1_760_000_000_000
    const step = stepAt(now, STEP)
    expect(Number.isSafeInteger(step)).toBe(true)
    expect(Number.isSafeInteger(stepStartMs(step, STEP))).toBe(true)
    expect(stepStartMs(step, STEP)).toBeLessThanOrEqual(now)
    expect(stepStartMs(step + 1, STEP)).toBeGreaterThan(now)
  })

  it('never lets two adjacent instants skip a step', () => {
    let previous = stepAt(1_760_000_000_000, STEP)
    for (let n = 1; n <= 2000; n++) {
      const step = stepAt(1_760_000_000_000 + n, STEP)
      expect(step - previous).toBeLessThanOrEqual(1)
      expect(step).toBeGreaterThanOrEqual(previous)
      previous = step
    }
  })

  it('floors rather than rounds, so a step owns its whole span', () => {
    // Rounding would put the first half of a step in the previous one, which
    // halves the usable lookahead and puts every hit 62ms early.
    expect(stepAt(125 * 10 + 124, STEP)).toBe(10)
    expect(stepAt(125 * 10, STEP)).toBe(10)
  })

  it('handles a bar length that divides a second evenly', () => {
    // 16 steps of 125ms is a 2s bar, so bar boundaries land on whole seconds of
    // wall-clock time. That is what makes the grid legible against any other
    // clock, and it only holds while stepMs divides 1000.
    expect((16 * STEP) % 1000).toBe(0)
    expect(stepAt(2000, STEP) % 16).toBe(0)
    expect(stepAt(4000, STEP) % 16).toBe(0)
  })
})

describe('the OSC timetag', () => {
  it('uses the 1900 epoch, which is what an OSC bundle expects', () => {
    expect(NTP_EPOCH_OFFSET).toBe(2_208_988_800)
  })

  it('converts a step to an NTP second that is still precise enough', () => {
    // NTP seconds at a real magnitude is ~4e9. A double has 53 bits, so about
    // 21 bits are left for the fraction — a resolution near half a microsecond,
    // which is far under a sample at 48kHz.
    const ntp = stepStartMs(stepAt(1_760_000_000_000, STEP), STEP) / 1000 + NTP_EPOCH_OFFSET
    const nextSample = ntp + 1 / 48_000
    expect(nextSample).toBeGreaterThan(ntp)
  })
})
