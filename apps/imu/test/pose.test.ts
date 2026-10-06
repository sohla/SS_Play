import { describe, expect, it } from 'vitest'
import { poseFrom, quaternionFromEuler, smooth, unipolar } from '../src/pose.ts'

const pose = (alpha: number, beta: number, gamma: number) =>
  poseFrom(quaternionFromEuler(alpha, beta, gamma))

describe('resting positions', () => {
  it('reads flat on a table as no tilt, screen up', () => {
    const flat = pose(0, 0, 0)
    expect(flat.roll).toBeCloseTo(0, 5)
    expect(flat.pitch).toBeCloseTo(0, 5)
    expect(flat.facing).toBeCloseTo(1, 5)
  })

  it('reads a tilt to the right as positive roll', () => {
    // gamma is rotation about the screen's vertical axis.
    expect(pose(0, 0, 45).roll).toBeGreaterThan(0.5)
    expect(pose(0, 0, -45).roll).toBeLessThan(-0.5)
  })

  it('rises as the phone is stood upright', () => {
    expect(pose(0, 45, 0).pitch).toBeGreaterThan(0.5)
    expect(pose(0, -45, 0).pitch).toBeLessThan(-0.5)
    expect(pose(0, 90, 0).pitch).toBeCloseTo(1, 4)
  })

  it('reads a phone held upright as facing neither up nor down', () => {
    expect(pose(0, 90, 0).facing).toBeCloseTo(0, 4)
  })
})

describe('the hole in Euler angles', () => {
  // This is the entire reason the page converts to a quaternion first. Beta
  // near 90° is a phone held upright to look at — the most ordinary posture
  // there is — and it is exactly where alpha and gamma become degenerate.
  it('does not jump when the phone passes through vertical', () => {
    const steps = []
    for (let beta = 80; beta <= 100; beta += 1) steps.push(pose(30, beta, 10))

    // Every consecutive pair, on every axis, must be a small step. A gimbal
    // lock shows up as one enormous one.
    for (let n = 1; n < steps.length; n++) {
      const previous = steps[n - 1]!
      const current = steps[n]!
      expect(Math.abs(current.roll - previous.roll)).toBeLessThan(0.1)
      expect(Math.abs(current.pitch - previous.pitch)).toBeLessThan(0.1)
      expect(Math.abs(current.facing - previous.facing)).toBeLessThan(0.1)
    }
  })

  it('moves tilt continuously as the phone is rolled right over', () => {
    let previous = pose(0, 0, -90)
    for (let gamma = -89; gamma <= 90; gamma += 1) {
      const current = pose(0, 0, gamma)
      expect(Math.abs(current.roll - previous.roll)).toBeLessThan(0.1)
      previous = current
    }
  })

  it('keeps tilt bounded however the phone is held', () => {
    for (let alpha = 0; alpha < 360; alpha += 37) {
      for (let beta = -180; beta <= 180; beta += 29) {
        for (let gamma = -90; gamma <= 90; gamma += 23) {
          const current = pose(alpha, beta, gamma)
          for (const value of [current.roll, current.pitch, current.facing]) {
            expect(Number.isFinite(value)).toBe(true)
            expect(Math.abs(value)).toBeLessThanOrEqual(1)
          }
          expect(current.yaw).toBeGreaterThanOrEqual(0)
          expect(current.yaw).toBeLessThan(1)
        }
      }
    }
  })
})

describe('control values', () => {
  it('maps a bipolar tilt onto the unit interval a spec expects', () => {
    expect(unipolar(-1)).toBe(0)
    expect(unipolar(0)).toBe(0.5)
    expect(unipolar(1)).toBe(1)
  })

  it('clamps rather than letting a stray reading leave the range', () => {
    expect(unipolar(-4)).toBe(0)
    expect(unipolar(4)).toBe(1)
  })

  it('smooths toward a target without overshooting it', () => {
    let value = 0
    for (let n = 0; n < 200; n++) value = smooth(value, 1)
    expect(value).toBeGreaterThan(0.99)
    expect(value).toBeLessThanOrEqual(1)
  })

  it('does not move when the reading has not', () => {
    // A phone at rest still reports a degree or two of jitter; what must not
    // happen is drift from the smoother itself.
    expect(smooth(0.42, 0.42)).toBeCloseTo(0.42, 10)
  })
})
