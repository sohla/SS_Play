/**
 * `geo`: where the phone is, where the target is, and what the drone does
 * about it. Plain numbers — no sensors, no audio — so it can be tested.
 *
 * ## Metres, not degrees
 *
 * Everything happens within tens of metres, so positions are converted once to
 * a flat east/north plane around the first fix. Over 30m the error from
 * ignoring the earth's curve is far below a millimetre, and far below GPS
 * noise, which is metres.
 *
 * ## GPS noise is the main event
 *
 * A phone reports a fix about once a second, and each fix is only good to its
 * `accuracy` — 3–10m outdoors with a clear sky, 20–50m or worse indoors. A
 * 10–30m target is therefore at the edge of what this can resolve, which is
 * worth knowing before composing with it. Fixes are blended by a small Kalman
 * filter that trusts each one by its stated accuracy, so a bad fix moves the
 * estimate a little and a good one a lot.
 */

const EARTH_RADIUS_M = 6_371_000
const RAD = Math.PI / 180

export interface LatLon {
  lat: number
  lon: number
}

export interface Point {
  /** Metres east of the origin. */
  east: number
  /** Metres north of the origin. */
  north: number
}

export function toLocal(origin: LatLon, at: LatLon): Point {
  return {
    east: (at.lon - origin.lon) * RAD * EARTH_RADIUS_M * Math.cos(origin.lat * RAD),
    north: (at.lat - origin.lat) * RAD * EARTH_RADIUS_M,
  }
}

export function toLatLon(origin: LatLon, point: Point): LatLon {
  return {
    lat: origin.lat + point.north / EARTH_RADIUS_M / RAD,
    lon: origin.lon + point.east / (EARTH_RADIUS_M * Math.cos(origin.lat * RAD)) / RAD,
  }
}

export function distance(from: Point, to: Point): number {
  return Math.hypot(to.east - from.east, to.north - from.north)
}

/** Degrees clockwise from north, 0..360. */
export function bearing(from: Point, to: Point): number {
  return ((Math.atan2(to.east - from.east, to.north - from.north) / RAD) % 360 + 360) % 360
}

/** A target `metres` away on `bearingDeg`. */
export function offset(from: Point, metres: number, bearingDeg: number): Point {
  return {
    east: from.east + metres * Math.sin(bearingDeg * RAD),
    north: from.north + metres * Math.cos(bearingDeg * RAD),
  }
}

/** 10–30m in a random direction, as the brief has it. */
export function pickTarget(from: Point, random: () => number = Math.random): Point {
  return offset(from, 10 + 20 * random(), 360 * random())
}

/**
 * The position estimate, east and north filtered alike.
 *
 * `variance` grows between fixes by `WALK` m²/s — about a walking pace of
 * uncertainty — and each fix is blended in by `variance / (variance + acc²)`.
 */
export interface Track {
  at: Point
  variance: number
  time: number
}

const WALK = 2

export function track(previous: Track | null, fix: Point, accuracy: number, time: number): Track {
  const measured = Math.max(1, accuracy) ** 2
  if (!previous) return { at: fix, variance: measured, time }

  const variance = previous.variance + (WALK * Math.max(0, time - previous.time)) / 1000
  const gain = variance / (variance + measured)
  return {
    at: {
      east: previous.at.east + gain * (fix.east - previous.at.east),
      north: previous.at.north + gain * (fix.north - previous.at.north),
    },
    variance: (1 - gain) * variance,
    time,
  }
}

/** Within this, the target counts as reached. About one good GPS fix's worth. */
export const ARRIVED_M = 4

export interface Drone {
  amp: number
  /** The fifth's detune, Hz. Wide far away, zero on arrival: distance is intonation. */
  beat: number
  cutoff: number
  pan: number
}

export interface Reading {
  /** Metres to the target now. */
  distance: number
  /** Metres to the target when it was picked. */
  start: number
  /** Degrees to the target, clockwise from north. */
  bearing: number
  /** Which way the phone points, degrees from north; null without a compass. */
  heading: number | null
}

/** 0 at the start distance, 1 at the target. */
export function closeness({ distance: d, start }: Reading): number {
  return Math.min(1, Math.max(0, 1 - d / Math.max(start, 1)))
}

/** 1 pointing straight at the target, 0 straight away; 0.5 without a compass. */
export function facing({ bearing: b, heading }: Reading): number {
  if (heading === null) return 0.5
  return (1 + Math.cos((b - heading) * RAD)) / 2
}

/**
 * Distance tunes the drone's fifth: out by 1.5Hz at the start, beating
 * audibly, settling to a pure fifth on arrival. Facing the target opens the
 * filter and the sound leans toward the side it is on. It gets a little
 * louder as you close in, never loud: the brief is warm and relaxed.
 */
export function droneFrom(reading: Reading): Drone {
  const near = closeness(reading)
  const towards = facing(reading)
  const side =
    reading.heading === null ? 0 : Math.sin((reading.bearing - reading.heading) * RAD)

  return {
    amp: 0.07 + 0.09 * near,
    beat: 1.5 * (1 - near),
    cutoff: 250 + 1750 * towards * (0.3 + 0.7 * near),
    pan: 0.6 * side,
  }
}
