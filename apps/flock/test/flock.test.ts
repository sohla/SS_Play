import { describe, expect, it } from 'vitest'
import {
  AT_REST,
  COUNT,
  VOICE_CAP,
  WORLD,
  grainsForStep,
  particlesAt,
  perturb,
  pitchOf,
  wrap,
  type View,
} from '../src/flock.ts'

// A real wall-clock instant, because the point is that the grid is anchored at the epoch.
const T = 1_787_000_000_000
const WINDOW: View = { cx: WORLD / 2, cy: WORLD / 2, halfW: 1.5, halfH: 1.5 }

describe('particlesAt', () => {
  it('is a pure function of time: same instant, same herd', () => {
    const a = new Float64Array(COUNT * 2)
    const b = new Float64Array(COUNT * 2)
    particlesAt(T, a)
    particlesAt(T, b)
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('moves continuously, with no jump at any remainder boundary', () => {
    // Steps across several period boundaries in the clock: each is a 1ms move.
    const a = new Float64Array(COUNT * 2)
    const b = new Float64Array(COUNT * 2)
    for (const offset of [0, 9_000, 71_000, 1_000_000]) {
      const t = Math.floor(T / 1_000_000) * 1_000_000 + offset
      particlesAt(t - 0.5, a)
      particlesAt(t + 0.5, b)
      for (let i = 0; i < COUNT * 2; i++) {
        expect(Math.abs(b[i]! - a[i]!)).toBeLessThan(0.01)
      }
    }
  })

  it('keeps the herd inside the world', () => {
    const out = new Float64Array(COUNT * 2)
    for (let k = 0; k < 200; k++) {
      particlesAt(T + k * 37_000, out)
      for (const v of out) {
        expect(v).toBeGreaterThan(-1)
        expect(v).toBeLessThan(WORLD + 1)
      }
    }
  })
})

describe('perturb', () => {
  it('leaves the shared flock exactly as it is at rest', () => {
    const out = new Float64Array(2)
    perturb(0.3, -0.7, AT_REST, out)
    expect([out[0], out[1]]).toEqual([0.3, -0.7])
  })

  it('pulls a nearby particle toward the well and pushes one away on a shake', () => {
    const out = new Float64Array(2)
    perturb(0, 0, { wellX: 0.3, wellY: 0, pull: 1, shake: 0 }, out)
    expect(out[0]).toBeGreaterThan(0)

    perturb(0.2, 0, { ...AT_REST, shake: 1 }, out)
    expect(out[0]).toBeGreaterThan(0.2)
  })
})

describe('wrap', () => {
  it('takes the short way round the torus', () => {
    expect(wrap(WORLD - 0.1)).toBeCloseTo(-0.1)
    expect(wrap(-WORLD + 0.1)).toBeCloseTo(0.1)
  })
})

describe('grainsForStep', () => {
  it('agrees with itself, so two devices sharing a window play the same grains', () => {
    const step = Math.floor(T / 125)
    expect(grainsForStep(step, 125, WINDOW, AT_REST)).toEqual(grainsForStep(step, 125, WINDOW, AT_REST))
  })

  it('never exceeds the voice cap, even shaking a crowded window', () => {
    for (let step = 1000; step < 1400; step++) {
      expect(grainsForStep(step, 125, WINDOW, { ...AT_REST, shake: 1 }).length).toBeLessThanOrEqual(
        VOICE_CAP,
      )
    }
  })

  it('is silent for a window with nothing in it', () => {
    const empty: View = { cx: 0.01, cy: 0.01, halfW: 0.001, halfH: 0.001 }
    expect(grainsForStep(1000, 125, empty, AT_REST)).toEqual([])
  })

  it('keeps every pitch inside the scale range and every pan inside the field', () => {
    for (let step = 5000; step < 5200; step++) {
      for (const event of grainsForStep(step, 125, WINDOW, AT_REST)) {
        expect(event.controls.freq).toBeGreaterThanOrEqual(pitchOf(0))
        expect(event.controls.freq).toBeLessThanOrEqual(pitchOf(1))
        expect(Math.abs(event.controls.pan!)).toBeLessThanOrEqual(1)
      }
    }
  })
})
