import { describe, expect, it } from 'vitest'
import { RESTING, type Motion } from '@ss/motion'
import {
  DEFAULT_CONTROLS,
  RANGES,
  CARRIER_ROOT,
  CARRIER_SEMITONES,
  RATE_STEPS,
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

  it('never lets a gesture touch the envelope', () => {
    // The shape is the thing that was tuned by hand, so no gesture may move it.
    // Only rate, carrier and the intensity gate are gesture-driven.
    const still = thrumFrom(RESTING, 0.5, withControls({ freeRun: false }))
    const moving = thrumFrom(
      at({ shake: 1, turn: 1, roll: 1, pitch: 1 }),
      0.5,
      withControls({ freeRun: false }),
    )

    for (const key of PARAMS) {
      if (key === 'intensity' || key === 'rate' || key === 'carrier') continue
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

  it('starts countable and reaches the start of flutter, and no further', () => {
    // The range crosses one boundary and stops on the second. That is the point
    // of its top end rather than an overshoot: a rhythm becomes a texture.
    // Fusion stays out of reach, so the page cannot turn into a continuous tone.
    expect(regimeOf(DEFAULT_CONTROLS.rate)).toBe('discrete')
    expect(regimeOf(RANGES.rate.min)).toBe('discrete')
    expect(regimeOf(RANGES.rate.max)).toBe('flutter')
    expect(RANGES.rate.max).toBeLessThan(32)
  })

  it('steps through three regimes, which is what the doublings buy', () => {
    const named = RATE_STEPS.map(regimeOf)
    expect(named).toEqual(['discrete', 'discrete', 'discrete', 'discrete', 'stutter', 'flutter'])
  })

  it('starts with no overdrive, so the boost is something you add', () => {
    expect(DEFAULT_CONTROLS.overdrive).toBe(RANGES.overdrive.min)
    expect(RANGES.overdrive.min).toBe(1)
  })

  it('starts held rather than struck, which is what the hand chose', () => {
    // The literature points at a struck decay; the hand picked the opposite end.
    // Together with a 91ms decay and a 14.5ms attack that is three independent
    // votes for sustained energy over a sharp event, which is what Pacinian
    // temporal summation predicts and the category literature obscures.
    expect(curveReads(DEFAULT_CONTROLS.curve)).toBe('held')
    expect(DEFAULT_CONTROLS.curve).toBe(RANGES.curve.max)
    expect(curveReads(0)).toBe('linear')
    expect(curveReads(RANGES.curve.min)).toBe('struck')
  })

  it('keeps the three hand-found values that contradict the literature', () => {
    // Pinned because they are the most valuable numbers on the page and the
    // easiest to lose to a tidy-up: each one looks wrong against the research.
    expect(DEFAULT_CONTROLS.decay).toBe(0.091)
    expect(DEFAULT_CONTROLS.attack).toBe(0.0145)
    expect(DEFAULT_CONTROLS.curve).toBe(4)
    expect(DEFAULT_CONTROLS.transient).toBe(0.38)
    expect(DEFAULT_CONTROLS.sharpness).toBe(0.48)
    expect(DEFAULT_CONTROLS.rate).toBe(2.4)
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

  it('makes every slider exact, with no gesture reaching any of them', () => {
    const shaken = thrumFrom(
      at({ shake: 1, turn: 1, roll: 1 }),
      0.5,
      withControls({ intensity: 0.4, rate: 5, carrier: 380 }),
    )
    expect(shaken.intensity).toBeCloseTo(0.4, 10)
    expect(shaken.rate).toBeCloseTo(5, 10)
    // Including the carrier, which rolling takes over as soon as free run is off.
    expect(shaken.carrier).toBeCloseTo(380, 10)
  })

  it('hands rate and carrier to the gestures when switched off', () => {
    const off = withControls({ freeRun: false })
    expect(thrumFrom(RESTING, 0.5, off).level).toBeLessThan(SILENCE_BELOW)

    // Acceleration steps the rate — not rotation, which drives the carrier now.
    expect(thrumFrom(at({ shake: 1 }), 0.5, off).rate).toBeGreaterThan(
      thrumFrom(at({ shake: 0 }), 0.5, off).rate,
    )
    expect(thrumFrom(at({ turn: 1 }), 0.5, off).rate).toBe(
      thrumFrom(at({ turn: 0 }), 0.5, off).rate,
    )

    expect(thrumFrom(at({ roll: 1 }), 0.5, off).carrier).toBeGreaterThan(
      thrumFrom(at({ roll: -1 }), 0.5, off).carrier,
    )
  })

  it('keeps the gesture-driven rate and carrier inside the declared ranges', () => {
    const off = withControls({ freeRun: false })
    for (const sens of [0.05, 0.5, 1]) {
      for (let n = 0; n <= 50; n++) {
        const now = thrumFrom(at({ turn: n / 50, shake: n / 50, roll: n / 25 - 1 }), sens, off)
        expect(now.carrier).toBeGreaterThanOrEqual(RANGES.carrier.min)
        expect(now.carrier).toBeLessThanOrEqual(RANGES.carrier.max)
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


describe('IMU mode: two gestures, both quantised', () => {
  const imu = (over: Partial<Motion>) => thrumFrom(at(over), 0.5, withControls({ freeRun: false }))

  it('includes the two doublings above 4Hz', () => {
    expect([...RATE_STEPS]).toEqual([1, 2, 3, 4, 8, 16])
    // Every step has to be inside what the SynthDef will accept, or the top of
    // the gesture silently clamps and two of the six become the same rate.
    for (const rate of RATE_STEPS) {
      expect(rate).toBeGreaterThanOrEqual(RANGES.rate.min)
      expect(rate).toBeLessThanOrEqual(RANGES.rate.max)
    }
  })

  it('steps the rate between whole numbers rather than sweeping it', () => {
    // multibeat's rule: moving changes the subdivision, never the tempo. A
    // continuous rate between the steps would be a glissando nobody asked for.
    const seen = new Set<number>()
    for (let n = 0; n <= 200; n++) seen.add(imu({ shake: n / 200 }).rate)

    for (const rate of seen) expect(RATE_STEPS).toContain(rate)
    // Every step has to be reachable, or the range is lying about itself.
    expect([...seen].sort((a, b) => a - b)).toEqual([...RATE_STEPS])
  })

  it('gives the lowest rate when still and the highest on a firm shake', () => {
    expect(imu({ shake: 0 }).rate).toBe(RATE_STEPS[0])
    expect(imu({ shake: 1 }).rate).toBe(RATE_STEPS[RATE_STEPS.length - 1])
  })

  it('moves the rate monotonically up with acceleration', () => {
    let previous = 0
    for (let n = 0; n <= 100; n++) {
      const rate = imu({ shake: n / 100 }).rate
      expect(rate).toBeGreaterThanOrEqual(previous)
      previous = rate
    }
  })

  it('sweeps the carrier up exactly one octave, in semitones', () => {
    expect(imu({ roll: -1 }).carrier).toBeCloseTo(CARRIER_ROOT, 6)
    expect(imu({ roll: 1 }).carrier).toBeCloseTo(CARRIER_ROOT * 2, 6)

    // Every value it can take is a semitone of the root, and there are exactly
    // thirteen of them across the travel.
    const notes = new Set<number>()
    for (let n = 0; n <= 400; n++) {
      const carrier = imu({ roll: n / 200 - 1 }).carrier
      const semitone = 12 * Math.log2(carrier / CARRIER_ROOT)
      expect(semitone).toBeCloseTo(Math.round(semitone), 6)
      notes.add(Math.round(semitone))
    }
    expect(notes.size).toBe(CARRIER_SEMITONES + 1)
  })

  it('keeps the gesture octave inside the range the slider allows', () => {
    // The gesture covers the useful middle; the slider can still reach the ends.
    expect(CARRIER_ROOT).toBeGreaterThanOrEqual(RANGES.carrier.min)
    expect(CARRIER_ROOT * 2).toBeLessThanOrEqual(RANGES.carrier.max)
  })

  it('is silent when still, and the slider still sets how loud', () => {
    // Movement decides whether, the slider decides how loud. Without the gate
    // the page would drone on a desk, which every other page here avoids.
    expect(imu({}).intensity).toBe(0)
    expect(imu({ shake: 1 }).intensity).toBeCloseTo(DEFAULT_CONTROLS.intensity, 6)
    expect(thrumFrom(at({ shake: 1 }), 0.5, withControls({ freeRun: false, intensity: 0.3 })).intensity).toBeCloseTo(0.3, 6)
  })
})
