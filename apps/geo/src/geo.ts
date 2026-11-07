/**
 * Positions, a target near them, and how loud the drone is for a distance.
 *
 * Everything works in a flat local frame of metres east and north of an origin.
 * Over the tens of metres this page covers, the curvature error is far below a
 * millimetre, and far below what any phone can measure.
 */

export interface LatLon {
  lat: number
  lon: number
}

export interface Local {
  east: number
  north: number
}

/** Mean Earth radius, in metres. */
const R = 6_371_008.8
const RAD = Math.PI / 180

export function toLocal(origin: LatLon, point: LatLon): Local {
  return {
    east: (point.lon - origin.lon) * RAD * R * Math.cos(origin.lat * RAD),
    north: (point.lat - origin.lat) * RAD * R,
  }
}

export function fromLocal(origin: LatLon, { east, north }: Local): LatLon {
  return {
    lat: origin.lat + north / R / RAD,
    lon: origin.lon + east / (R * Math.cos(origin.lat * RAD)) / RAD,
  }
}

export function distance(a: Local, b: Local): number {
  return Math.hypot(a.east - b.east, a.north - b.north)
}

export const NEAREST_M = 5
export const FARTHEST_M = 20

/** Somewhere 5–20m away, in any direction. `random` is injectable so tests can pin it. */
export function pickTarget(random: () => number = Math.random): Local {
  const bearing = random() * 2 * Math.PI
  const range = NEAREST_M + random() * (FARTHEST_M - NEAREST_M)
  return { east: range * Math.sin(bearing), north: range * Math.cos(bearing) }
}

/**
 * A fix good enough to choose a target from.
 *
 * The Geolocation API's `accuracy` is the radius of 95% confidence. A target
 * 5m away chosen from a fix that could be 30m out is a target nobody can find,
 * so the page waits for this, or for the walker to say go.
 */
export const GOOD_FIX_M = 12

/**
 * Where the phone probably is, from a stream of noisy fixes.
 *
 * A Kalman filter per axis on a model of "standing still, but allowed to
 * wander". Each fix is weighted by the accuracy it came with: one from GPS at
 * ±4m pulls hard, one from Wi-Fi at ±40m barely moves it. Standing still, the
 * raw fixes wander by a few metres; this is what keeps the drone from swelling
 * and fading while nobody moves.
 *
 * No velocity term. Walking speed outruns it by a step or so, which the ear
 * forgives; a velocity model fed fixes this noisy overshoots, which it doesn't.
 */
export class Track {
  /**
   * How far the walker may have gone since the last fix, as variance per second.
   * About walking pace squared, doubled: with ±8m fixes once a second this
   * trails a walker by under 2m and holds a standing one to a metre or so.
   */
  static readonly WANDER_M2_PER_S = 4

  #at: Local | null = null
  #variance = 0
  #time = 0

  get position(): Local | null {
    return this.#at
  }

  /** One standard deviation, in metres. */
  get sigma(): number {
    return Math.sqrt(this.#variance)
  }

  /** `accuracy` is the fix's own 95% radius; `time` is its timestamp in ms. */
  update(fix: Local, accuracy: number, time: number): Local {
    // 95% of a two-dimensional normal lies within about 2.45σ.
    const measured = (accuracy / 2.45) ** 2
    if (this.#at === null) {
      this.#at = fix
      this.#variance = measured
    } else {
      const seconds = Math.max(0, (time - this.#time) / 1000)
      const predicted = this.#variance + Track.WANDER_M2_PER_S * seconds
      const gain = predicted / (predicted + measured)
      this.#at = {
        east: this.#at.east + gain * (fix.east - this.#at.east),
        north: this.#at.north + gain * (fix.north - this.#at.north),
      }
      this.#variance = (1 - gain) * predicted
    }
    this.#time = time
    return this.#at
  }
}

/** Within this, you are there. Smaller than any phone can promise, so it reads as "found it". */
export const ARRIVED_M = 2.5

export const LOUDEST_DB = -10
/** Where the drone starts: audible from the first step, so there is something to follow. */
export const START_DB = -32
export const QUIETEST_DB = -50

/**
 * The drone's level for a distance, in dB.
 *
 * A straight line in dB from the starting distance to arrival, which the ear
 * hears as steady progress, carried on past the start so walking the wrong way
 * keeps getting quieter rather than hitting a floor that says nothing.
 */
export function levelDb(metres: number, start: number): number {
  const span = Math.max(1, start - ARRIVED_M)
  const db = LOUDEST_DB + ((START_DB - LOUDEST_DB) * (metres - ARRIVED_M)) / span
  return Math.min(LOUDEST_DB, Math.max(QUIETEST_DB, db))
}

/** 0 at the start, 1 on arrival, for the parts of the sound that brighten as you close in. */
export function nearness(metres: number, start: number): number {
  return Math.min(1, Math.max(0, (start - metres) / Math.max(1, start - ARRIVED_M)))
}
