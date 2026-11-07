import { describe, expect, it } from 'vitest'
import {
  ARRIVED_M,
  FARTHEST_M,
  LOUDEST_DB,
  NEAREST_M,
  QUIETEST_DB,
  START_DB,
  Track,
  distance,
  fromLocal,
  levelDb,
  nearness,
  pickTarget,
  toLocal,
} from '../src/geo.ts'

const MELBOURNE = { lat: -37.8136, lon: 144.9631 }

describe('the local frame', () => {
  it('round-trips through latitude and longitude', () => {
    const point = { east: 13.2, north: -7.9 }
    const back = toLocal(MELBOURNE, fromLocal(MELBOURNE, point))
    expect(back.east).toBeCloseTo(point.east, 6)
    expect(back.north).toBeCloseTo(point.north, 6)
  })

  it('agrees with the haversine distance to well under a centimetre at 20m', () => {
    const there = fromLocal(MELBOURNE, { east: 12, north: 16 })
    const rad = Math.PI / 180
    const dLat = (there.lat - MELBOURNE.lat) * rad
    const dLon = (there.lon - MELBOURNE.lon) * rad
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(MELBOURNE.lat * rad) * Math.cos(there.lat * rad) * Math.sin(dLon / 2) ** 2
    const haversine = 2 * 6_371_008.8 * Math.asin(Math.sqrt(h))
    expect(Math.abs(haversine - 20)).toBeLessThan(0.005)
  })
})

describe('pickTarget', () => {
  it('always lands 5–20m away', () => {
    for (let n = 0; n < 1000; n++) {
      const metres = distance({ east: 0, north: 0 }, pickTarget())
      expect(metres).toBeGreaterThanOrEqual(NEAREST_M - 1e-9)
      expect(metres).toBeLessThanOrEqual(FARTHEST_M + 1e-9)
    }
  })

  it('reaches both ends and every direction', () => {
    expect(distance({ east: 0, north: 0 }, pickTarget(() => 0))).toBeCloseTo(NEAREST_M)
    const north = pickTarget(() => 0)
    expect(north.north).toBeGreaterThan(0)
    const south = pickTarget(() => 0.5)
    expect(south.north).toBeLessThan(0)
  })
})

/** A cheap seeded generator, and a normal from it, so noisy runs are repeatable. */
function noise(seed: number) {
  let state = seed
  const uniform = () => ((state = (state * 1664525 + 1013904223) >>> 0) + 0.5) / 2 ** 32
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform())
}

describe('Track', () => {
  it('takes the first fix as it comes', () => {
    const track = new Track()
    expect(track.update({ east: 3, north: 4 }, 10, 0)).toEqual({ east: 3, north: 4 })
  })

  it('holds a standing phone much steadier than the fixes it is given', () => {
    const gauss = noise(7)
    const track = new Track()
    const accuracy = 8
    const sigma = accuracy / 2.45
    let rawSpread = 0
    let heldSpread = 0
    for (let second = 0; second < 300; second++) {
      const fix = { east: gauss() * sigma, north: gauss() * sigma }
      const held = track.update(fix, accuracy, second * 1000)
      if (second >= 30) {
        rawSpread += Math.hypot(fix.east, fix.north)
        heldSpread += Math.hypot(held.east, held.north)
      }
    }
    expect(heldSpread / rawSpread).toBeLessThan(0.6)
  })

  it('keeps up with a walker to within a couple of metres', () => {
    const gauss = noise(11)
    const track = new Track()
    const accuracy = 8
    const sigma = accuracy / 2.45
    let total = 0
    for (let second = 0; second < 60; second++) {
      const truth = { east: 1.4 * second, north: 0 }
      const held = track.update(
        { east: truth.east + gauss() * sigma, north: truth.north + gauss() * sigma },
        accuracy,
        second * 1000,
      )
      if (second >= 10) {
        total += distance(held, truth)
      }
    }
    expect(total / 50).toBeLessThan(3)
  })

  it('barely moves for a wild, low-accuracy fix', () => {
    const track = new Track()
    track.update({ east: 0, north: 0 }, 5, 0)
    const after = track.update({ east: 60, north: 0 }, 80, 1000)
    expect(after.east).toBeLessThan(2)
  })
})

describe('levelDb', () => {
  it('starts quiet, arrives loud, and is louder at every step closer', () => {
    const start = 15
    expect(levelDb(start, start)).toBeCloseTo(START_DB)
    expect(levelDb(ARRIVED_M, start)).toBeCloseTo(LOUDEST_DB)
    expect(levelDb(0, start)).toBe(LOUDEST_DB)
    for (let metres = start; metres > ARRIVED_M; metres -= 0.5) {
      expect(levelDb(metres - 0.5, start)).toBeGreaterThan(levelDb(metres, start))
    }
  })

  it('keeps falling past the start, to a floor', () => {
    expect(levelDb(20, 10)).toBeLessThan(START_DB)
    expect(levelDb(500, 10)).toBe(QUIETEST_DB)
  })

  it('does not divide by nothing when the target starts at your feet', () => {
    expect(Number.isFinite(levelDb(1, ARRIVED_M))).toBe(true)
  })
})

describe('nearness', () => {
  it('runs 0 to 1 from start to arrival, clamped either side', () => {
    expect(nearness(12, 12)).toBe(0)
    expect(nearness(30, 12)).toBe(0)
    expect(nearness(ARRIVED_M, 12)).toBeCloseTo(1)
    expect(nearness(0, 12)).toBe(1)
  })
})
