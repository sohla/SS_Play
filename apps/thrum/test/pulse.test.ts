import { describe, expect, it } from 'vitest'
import { RESTING, type Motion } from '@ss/motion'
import {
  DEFAULT_CONTROLS,
  RANGES,
  REGIMES,
  SILENCE_BELOW,
  STEVENS,
  TAP_BOUNDARY_S,
  amplitudeOf,
  curveReads,
  decayReads,
  regimeOf,
  thrumFrom,
  type Controls,
} from '../src/mapping.ts'

/**
 * One pulse, nine parameters.
 *
 * The page is a test bench now, so the suite's job has changed with it. It is no
 * longer asserting that an instrument behaves musically — it is asserting that
 * **every parameter is reachable, independent, and inside what the SynthDef
 * declares**, because the whole value of the page is that a hand can move one
 * thing at a time and trust the number it is reading.
 *
 * Three earlier versions failed on exactly that. Each one had a control that was
 * either derived from another control, driven by a gesture at the same time, or
 * absent. A suite that only checked ranges passed through all three.
 */

const at = (over: Partial<Motion>): Motion => ({ ...RESTING, live: true, ...over })
const withControls = (over: Partial<Controls>): Controls => ({ ...DEFAULT_CONTROLS, ...over })

/** The nine, and the two that are not numbers are excluded by construction. */
const PARAMS = [
  'carrier',
  'rate',
  'intensity',
  'attack',
  'decay',
  'curve',
  'overdrive',
  'transient',
  'sharpness',
] as const

describe('every parameter is independent', () => {
  // The assertion the three previous versions would all have failed. Moving one
  // control must move exactly one output — not two, and not zero.
  it('changes exactly one output per control', () => {
    const reads = (controls: Controls) => {
      const now = thrumFrom(RESTING, 0.5, controls)
      return PARAMS.map((key) => now[key])
    }
    const base = reads(DEFAULT_CONTROLS)

    PARAMS.forEach((key, index) => {
      // Somewhere inside the range and definitely not the default.
      const { min, max } = RANGES[key]
      const target = DEFAULT_CONTROLS[key] === min ? max : min
      const moved = reads(withControls({ [key]: target }))

      const differing = moved.filter((v, n) => Math.abs(v - (base[n] ?? 0)) > 1e-12).length
      expect(differing, `moving ${key} moved ${differing} outputs`).toBe(1)
      expect(moved[index]).not.toBeCloseTo(base[index] ?? 0, 6)
    })
  })

  it('never lets a gesture touch anything but intensity and rate', () => {
    // A parameter being judged must not also be moving. Only the two the page
    // says are gesture-driven may differ between a still phone and a shaken one.
    const still = thrumFrom(RESTING, 0.5, withControls({ freeRun: false }))
    const moving = thrumFrom(at({ shake: 1, turn: 1, roll: 1, pitch: 1 }), 0.5, withControls({ freeRun: false }))

    for (const key of PARAMS) {
      if (key === 'intensity' || key === 'rate') continue
      expect(moving[key], `${key} moved with the hand`).toBeCloseTo(still[key], 10)
    }
  })

  it('clamps every parameter into the range the SynthDef declares', () => {
    for (const key of PARAMS) {
      for (const absurd of [-1e6, -1, 0, 1e6]) {
        const now = thrumFrom(RESTING, 0.5, withControls({ [key]: absurd }))
        expect(now[key], `${key} at ${absurd}`).toBeGreaterThanOrEqual(RANGES[key].min)
        expect(now[key], `${key} at ${absurd}`).toBeLessThanOrEqual(RANGES[key].max)
      }
    }
  })

  it('has a default inside its own range for all nine', () => {
    for (const key of PARAMS) {
      expect(DEFAULT_CONTROLS[key], key).toBeGreaterThanOrEqual(RANGES[key].min)
      expect(DEFAULT_CONTROLS[key], key).toBeLessThanOrEqual(RANGES[key].max)
    }
  })
})

describe('the defaults are the ones the research gives', () => {
  it('puts the carrier on the Pacinian peak', () => {
    expect(DEFAULT_CONTROLS.carrier).toBe(250)
  })

  it('puts the decay above the tap boundary, not below it', () => {
    // The correction that this whole page turned on. A burst short enough to read
    // unambiguously as a tap is close to undetectable, because the Pacinian
    // channel summates energy over about a second. So the default is on the
    // detectable side, and the range reaches both.
    expect(DEFAULT_CONTROLS.decay).toBeGreaterThan(TAP_BOUNDARY_S)
    expect(decayReads(DEFAULT_CONTROLS.decay)).toBe('buzz')

    expect(RANGES.decay.min).toBeLessThan(TAP_BOUNDARY_S)
    expect(RANGES.decay.max).toBeGreaterThan(TAP_BOUNDARY_S * 10)
    expect(decayReads(RANGES.decay.min)).toBe('tap')
  })

  it('starts the rate below the segregation rate, and can reach fusion', () => {
    expect(regimeOf(DEFAULT_CONTROLS.rate)).toBe('discrete')
    expect(regimeOf(RANGES.rate.max)).toBe('fused')
  })

  it('reaches every regime across the rate range, in order', () => {
    const seen: string[] = []
    for (let n = 0; n <= 400; n++) {
      const rate = RANGES.rate.min + ((RANGES.rate.max - RANGES.rate.min) * n) / 400
      const name = regimeOf(rate)
      if (seen[seen.length - 1] !== name) seen.push(name)
    }
    expect(seen).toEqual(REGIMES.map((regime) => regime.name))
  })

  it('starts with no overdrive, so the boost is something you add', () => {
    expect(DEFAULT_CONTROLS.overdrive).toBe(RANGES.overdrive.min)
    expect(RANGES.overdrive.min).toBe(1)
  })

  it('starts with a struck envelope rather than a linear one', () => {
    expect(curveReads(DEFAULT_CONTROLS.curve)).toBe('struck')
    // And can reach linear and held, since nothing says which a hand prefers.
    expect(curveReads(0)).toBe('linear')
    expect(curveReads(RANGES.curve.max)).toBe('held')
  })
})

describe('intensity is corrected for perception', () => {
  // Subjective magnitude grows as amplitude^0.6 at 250Hz, so a physically linear
  // control feels compressive. The graph raises the control to 1/0.6.
  it('is compressive, so the amplitude sits below the slider', () => {
    expect(STEVENS).toBe(0.6)
    expect(amplitudeOf(0.5)).toBeLessThan(0.5)
    expect(amplitudeOf(0.5)).toBeCloseTo(0.5 ** (1 / 0.6), 10)
  })

  it('still spans the full range end to end', () => {
    expect(amplitudeOf(0)).toBe(0)
    expect(amplitudeOf(1)).toBe(1)
  })

  it('is monotonic, so the slider never reverses', () => {
    let previous = -1
    for (let n = 0; n <= 100; n++) {
      const amp = amplitudeOf(n / 100)
      expect(amp).toBeGreaterThanOrEqual(previous)
      previous = amp
    }
  })
})

describe('free run', () => {
  it('is on by default, because the page is a test bench', () => {
    // Every other page here is silent until moved. This one has to sound while
    // the phone is held still, or the thing being judged is the arm.
    expect(DEFAULT_CONTROLS.freeRun).toBe(true)
    expect(thrumFrom(RESTING).level).toBeGreaterThan(SILENCE_BELOW)
  })

  it('makes every slider exact', () => {
    const shaken = thrumFrom(at({ shake: 1, turn: 1 }), 0.5, withControls({ intensity: 0.4, rate: 7 }))
    expect(shaken.intensity).toBeCloseTo(0.4, 10)
    expect(shaken.rate).toBeCloseTo(7, 10)
  })

  it('hands intensity and rate to the gestures when switched off', () => {
    const off = withControls({ freeRun: false })
    expect(thrumFrom(RESTING, 0.5, off).level).toBeLessThan(SILENCE_BELOW)
    expect(thrumFrom(at({ shake: 1 }), 0.5, off).intensity).toBeGreaterThan(
      thrumFrom(at({ shake: 0.05 }), 0.5, off).intensity,
    )
    expect(thrumFrom(at({ turn: 1 }), 0.5, off).rate).toBeGreaterThan(
      thrumFrom(at({ turn: 0.05 }), 0.5, off).rate,
    )
  })

  it('keeps the gesture-driven rate inside the declared range', () => {
    const off = withControls({ freeRun: false })
    for (const sens of [0.05, 0.5, 1]) {
      for (let n = 0; n <= 50; n++) {
        const now = thrumFrom(at({ turn: n / 50, shake: n / 50 }), sens, off)
        expect(now.rate).toBeGreaterThanOrEqual(RANGES.rate.min)
        expect(now.rate).toBeLessThanOrEqual(RANGES.rate.max)
        expect(now.intensity).toBeGreaterThanOrEqual(0)
        expect(now.intensity).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('the plot shows the diagnostic pair', () => {
  it('reports intensity against the raw and filtered shake', () => {
    const now = thrumFrom(at({ shake: 0.6 }), 0.5, withControls({ freeRun: false }))
    expect(now.drive).toHaveLength(3)
    expect(now.drive[0]).toBeCloseTo(now.intensity, 10)
    for (const value of now.drive) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
})
