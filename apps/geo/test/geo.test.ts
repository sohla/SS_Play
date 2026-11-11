import { describe, expect, it } from 'vitest'
import {
  ARRIVED_M,
  bearing,
  closeness,
  distance,
  droneFrom,
  facing,
  offset,
  pickTarget,
  toLatLon,
  toLocal,
  track,
  type Point,
} from '../src/geo.ts'

/** Melbourne, where these are composed. */
const HOME = { lat: -37.8136, lon: 144.9631 }
const HERE: Point = { east: 0, north: 0 }

describe('the plane', () => {
  it('round-trips a position through metres', () => {
    const away = toLatLon(HOME, { east: 20, north: -15 })
    const back = toLocal(HOME, away)
    expect(back.east).toBeCloseTo(20, 6)
    expect(back.north).toBeCloseTo(-15, 6)
  })

  it('agrees with the haversine distance over tens of metres', () => {
    const away = toLatLon(HOME, { east: 18, north: 24 })
    const R = 6_371_000
    const rad = Math.PI / 180
    const a =
      Math.sin(((away.lat - HOME.lat) * rad) / 2) ** 2 +
      Math.cos(HOME.lat * rad) * Math.cos(away.lat * rad) * Math.sin(((away.lon - HOME.lon) * rad) / 2) ** 2
    const haversine = 2 * R * Math.asin(Math.sqrt(a))
    expect(distance(HERE, toLocal(HOME, away))).toBeCloseTo(haversine, 2)
  })

  it('measures bearings clockwise from north', () => {
    expect(bearing(HERE, { east: 0, north: 10 })).toBeCloseTo(0)
    expect(bearing(HERE, { east: 10, north: 0 })).toBeCloseTo(90)
    expect(bearing(HERE, { east: 0, north: -10 })).toBeCloseTo(180)
    expect(bearing(HERE, { east: -10, north: 0 })).toBeCloseTo(270)
  })

  it('picks a target 10–30m away', () => {
    let seed = 7
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let n = 0; n < 200; n++) {
      const d = distance(HERE, pickTarget(HERE, random))
      expect(d).toBeGreaterThanOrEqual(10)
      expect(d).toBeLessThanOrEqual(30)
    }
  })
})

describe('the track', () => {
  it('trusts a precise fix more than a vague one', () => {
    const start = track(null, HERE, 5, 0)
    const precise = track(start, { east: 10, north: 0 }, 3, 1000)
    const vague = track(start, { east: 10, north: 0 }, 40, 1000)
    expect(precise.at.east).toBeGreaterThan(vague.at.east)
    expect(vague.at.east).toBeLessThan(2)
  })

  it('settles near the truth through scattered fixes', () => {
    let seed = 3
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const truth = { east: 12, north: -8 }
    let estimate = track(null, { east: 0, north: 0 }, 30, 0)
    for (let n = 1; n <= 60; n++) {
      const fix = { east: truth.east + (random() - 0.5) * 16, north: truth.north + (random() - 0.5) * 16 }
      estimate = track(estimate, fix, 8, n * 1000)
    }
    // Fixes scattered ±8m, filtered: within a couple of metres.
    expect(distance(estimate.at, truth)).toBeLessThan(3)
  })
})

describe('the drone', () => {
  const at = (d: number, heading: number | null, bearingDeg = 90) =>
    ({ distance: d, start: 20, bearing: bearingDeg, heading })

  it('tunes the fifth as you close in: beating far away, pure on arrival', () => {
    expect(droneFrom(at(20, null)).beat).toBeCloseTo(1.5)
    expect(droneFrom(at(10, null)).beat).toBeCloseTo(0.75)
    expect(droneFrom(at(0, null)).beat).toBeCloseTo(0)
    expect(droneFrom(at(ARRIVED_M, null)).beat).toBeLessThan(0.4)
  })

  it('never gets louder than relaxed', () => {
    for (const d of [40, 20, 5, 0]) expect(droneFrom(at(d, 90)).amp).toBeLessThanOrEqual(0.16)
  })

  it('opens up facing the target and leans toward its side', () => {
    const toward = droneFrom(at(10, 90))
    const away = droneFrom(at(10, 270))
    expect(toward.cutoff).toBeGreaterThan(away.cutoff)
    // Target due east, phone facing north: it is on the right.
    expect(droneFrom(at(10, 0)).pan).toBeGreaterThan(0.5)
    expect(droneFrom(at(10, 180)).pan).toBeLessThan(-0.5)
  })

  it('brightens with facing alone, across four octaves, from the first step', () => {
    for (const d of [20, 10, 0]) {
      expect(droneFrom(at(d, 270)).cutoff).toBeCloseTo(250)
      expect(droneFrom(at(d, 0)).cutoff).toBeCloseTo(1000)
      expect(droneFrom(at(d, 90)).cutoff).toBeCloseTo(4000)
    }
  })

  it('sits in the middle without a compass', () => {
    expect(facing(at(10, null))).toBe(0.5)
    expect(droneFrom(at(10, null)).pan).toBe(0)
  })

  it('clamps closeness beyond the start and at the target', () => {
    expect(closeness(at(35, null))).toBe(0)
    expect(closeness(at(0, null))).toBe(1)
    expect(offset(HERE, 10, 90).east).toBeCloseTo(10)
  })
})
