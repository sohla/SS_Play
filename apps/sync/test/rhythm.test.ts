import { describe, expect, it } from 'vitest'
import {
  BAR_MS,
  KICK,
  HAT,
  LIBRARY,
  SNARE,
  STEPS_PER_BAR,
  STEP_MS,
  barOf,
  beatOf,
  eventsForStep,
  stepInBar,
} from '../src/rhythm.ts'

/**
 * The pattern is a pure function of an absolute step, and that is the property
 * worth testing: it is what makes two devices play the same bar without talking.
 */

const DRUMS = { kick: 10, snare: 11, hat: 12 }

describe('the pattern depends on nothing but the step index', () => {
  it('gives the same events for the same step, always', () => {
    // No state, no start time, no phase to get wrong. Called twice, a thousand
    // steps apart in wall-clock terms, it answers identically.
    for (const step of [0, 7, 4_321, 14_000_000_000]) {
      expect(eventsForStep(step, DRUMS)).toEqual(eventsForStep(step, DRUMS))
    }
  })

  it('repeats every bar, including across a negative step', () => {
    // Steps are floored from a clock, so a device whose clock is before 1970 is
    // absurd but must not crash or produce a nonsense index.
    for (const step of [0, 1, 15, 16, 31]) {
      expect(eventsForStep(step, DRUMS)).toEqual(eventsForStep(step + STEPS_PER_BAR, DRUMS))
    }
    expect(stepInBar(-1)).toBe(15)
    expect(stepInBar(-16)).toBe(0)
    expect(eventsForStep(-16, DRUMS)).toEqual(eventsForStep(0, DRUMS))
  })

  it('is silent until the buffers exist', () => {
    // The scheduler is built before the samples finish loading, so every step
    // has to be a legal rest rather than a hit on buffer zero — which would be
    // whatever another page left there.
    for (let step = 0; step < STEPS_PER_BAR; step++) {
      expect(eventsForStep(step, null)).toEqual([])
    }
  })
})

describe('the rhythm is the most obvious one available', () => {
  it('puts a kick on all four quarters', () => {
    for (const step of [0, 4, 8, 12]) {
      const kicks = eventsForStep(step, DRUMS).filter((e) => e.controls['bufnum'] === DRUMS.kick)
      expect(kicks, `step ${step}`).toHaveLength(1)
    }
  })

  it('puts a snare on two and four only', () => {
    const snaredAt = [...Array(STEPS_PER_BAR).keys()].filter((step) =>
      eventsForStep(step, DRUMS).some((e) => e.controls['bufnum'] === DRUMS.snare),
    )
    expect(snaredAt).toEqual([4, 12])
  })

  it('puts a hat on the offbeat eighths only', () => {
    const hatsAt = [...Array(STEPS_PER_BAR).keys()].filter((step) =>
      eventsForStep(step, DRUMS).some((e) => e.controls['bufnum'] === DRUMS.hat),
    )
    expect(hatsAt).toEqual([2, 6, 10, 14])
  })

  it('never leaves a bar without a downbeat', () => {
    // A flam on a kick is the most audible error a rhythm can have, which is
    // exactly why the test is on a kick.
    expect(eventsForStep(0, DRUMS).length).toBeGreaterThan(0)
    expect(eventsForStep(STEPS_PER_BAR * 999, DRUMS).length).toBeGreaterThan(0)
  })

  it('releases every hit, so a one-shot cannot fill maxNodes', () => {
    // `ssp_kit` is an adsr with a gate: without a sustain the node lives until
    // the server runs out, which on a page meant to run for an hour matters.
    for (let step = 0; step < STEPS_PER_BAR; step++) {
      for (const event of eventsForStep(step, DRUMS)) {
        expect(event.sustain, `step ${step}`).toBeGreaterThan(0)
        expect(event.def).toBe('ssp_kit')
      }
    }
  })
})

describe('the grid is legible against a wall clock', () => {
  it('is 120bpm in sixteenths, with a bar of exactly two seconds', () => {
    expect(STEP_MS).toBe(125)
    expect(STEPS_PER_BAR).toBe(16)
    expect(BAR_MS).toBe(2000)
    // The property that makes a downbeat land on a whole second.
    expect(1000 % STEP_MS).toBe(0)
    expect(BAR_MS % 1000).toBe(0)
  })

  it('numbers the beats one to four, and nothing in between', () => {
    expect([0, 4, 8, 12].map(beatOf)).toEqual([1, 2, 3, 4])
    for (const step of [1, 2, 3, 5, 6, 7, 15]) expect(beatOf(step)).toBeNull()
  })

  it('counts bars from the epoch', () => {
    expect(barOf(0)).toBe(0)
    expect(barOf(15)).toBe(0)
    expect(barOf(16)).toBe(1)
  })
})

describe('the sample set', () => {
  it('is three drums, named rather than discovered', () => {
    // The store is shared. A page that took everything in it would change what
    // it plays whenever something unrelated was pushed.
    expect([...LIBRARY]).toEqual([KICK, SNARE, HAT])
    expect(LIBRARY).toHaveLength(3)
    for (const name of LIBRARY) expect(name).toMatch(/^kit_.*\.flac$/)
  })
})
