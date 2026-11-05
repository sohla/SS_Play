import { describe, expect, it } from 'vitest'
import contract from '../../../sidecar/dist/ssp_call.contract.json' with { type: 'json' }
import {
  BASE_PERIOD_MS,
  CALL,
  WRAP,
  agreement,
  createCaller,
  createClock,
  due,
  hear,
  type Caller,
} from '../src/chorus.ts'

/** `ssp_call_listen`'s default. */
const HOLDOFF_MS = 50

/** Deterministic randomness, so a failing room can be replayed. */
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

interface Device {
  caller: Caller
  /** Speaker latency: scheduled call to sound in the air. */
  out: number
  /** Mic latency plus the detector's 80ms. */
  in: number
  /** Where this device's detector clock happens to start against the wall. */
  clock: number
}

/**
 * A room. Every call is heard by every device, its caller included, after that
 * device's own input latency; the detector's timestamp is exact but the message
 * carrying it reaches the page 5–20ms later.
 */
function simulate(devices: Device[], seconds: number, random: () => number) {
  const pending: { device: Device; detectorMs: number; receivedAt: number }[] = []
  const calls: { who: number; at: number }[] = []
  const deafUntil = new Map<Device, number>()

  for (let now = 0; now < seconds * 1000; now += 5) {
    devices.forEach((device, who) => {
      const at = due(device.caller, now + 150)
      if (at === null) return
      calls.push({ who, at })
      const sounded = at + device.out
      for (const listener of devices) {
        const heardAt = sounded + listener.in + (random() - 0.5) * 2
        pending.push({
          device: listener,
          detectorMs: heardAt + listener.clock,
          receivedAt: heardAt + 5 + random() * 15,
        })
      }
    })

    // In the order they were heard, and at most one per holdoff: overlapping
    // calls are one detection, the earliest, as `ssp_call_listen` reports them.
    pending.sort((a, b) => a.detectorMs - a.device.clock - (b.detectorMs - b.device.clock))
    for (let n = 0; n < pending.length; n++) {
      const message = pending[n]!
      if (message.receivedAt > now) continue
      pending.splice(n--, 1)
      const deaf = deafUntil.get(message.device) ?? -Infinity
      if (message.detectorMs < deaf) continue
      deafUntil.set(message.device, message.detectorMs + HOLDOFF_MS)
      hear(message.device.caller, message.detectorMs, message.receivedAt)
    }
  }
  return calls
}

/** How far apart the devices' calls are, over the last few rounds. */
function spreadAtEnd(calls: { who: number; at: number }[], devices: number) {
  const last = calls.slice(-devices * 5)
  const rounds: number[] = []
  for (let n = 0; n + devices <= last.length; n += devices) {
    const round = last.slice(n, n + devices).map(({ at }) => at)
    rounds.push(Math.max(...round) - Math.min(...round))
  }
  return Math.max(...rounds)
}

function room(random: () => number, latencies: [number, number][]): Device[] {
  return latencies.map(([out, inLatency]) => ({
    caller: createCaller(0, random),
    out,
    in: inLatency,
    clock: random() * 1e6,
  }))
}

describe('a room of devices', () => {
  it('falls into step when the hardware is alike', () => {
    const random = seeded(1)
    const devices = room(random, [
      [40, 100],
      [40, 100],
      [40, 100],
      [40, 100],
    ])
    const calls = simulate(devices, 300, random)
    // Not zero: a neighbour inside SELF_WINDOW_MS (12) of our echo cannot be
    // told from it, so it is not coupled to. That window, plus jitter, is the floor.
    expect(spreadAtEnd(calls, devices.length)).toBeLessThan(20)
  })

  it('agrees on a tempo, not only a phase', () => {
    const random = seeded(2)
    const devices = room(random, [
      [40, 100],
      [40, 100],
      [40, 100],
    ])
    simulate(devices, 300, random)
    const periods = devices.map(({ caller }) => caller.period)
    expect(Math.max(...periods) - Math.min(...periods)).toBeLessThan(5)
  })

  it('lands within the speaker latencies it cannot see, when the hardware differs', () => {
    // Each device subtracts its *own* output latency from everyone's calls. The
    // error is the difference between speakers — here up to 60ms — and the
    // pair settles about that far apart, no further.
    const random = seeded(3)
    const devices = room(random, [
      [20, 90],
      [50, 130],
      [80, 110],
    ])
    const calls = simulate(devices, 300, random)
    expect(spreadAtEnd(calls, devices.length)).toBeLessThan(70)
  })

  it('does it slowly: still apart after the first few calls', () => {
    const random = seeded(4)
    const devices = room(random, [
      [40, 100],
      [40, 100],
    ])
    const early = simulate(devices, 12, random)
    expect(spreadAtEnd(early, 2)).toBeGreaterThan(100)
  })

  it('learns its own delay, and then ignores its own echo', () => {
    const random = seeded(5)
    const devices = room(random, [[40, 100]])
    simulate(devices, 30, random)
    const { caller } = devices[0]!
    expect(caller.delay! - devices[0]!.clock).toBeCloseTo(140, -1)
    // Alone, so everything it heard was itself and nothing was coupled.
    expect(caller.heard).toEqual([])
    expect(caller.period).toBeGreaterThan(BASE_PERIOD_MS * 0.9)
  })
})

describe('agreement', () => {
  it('is 1 when every call lands on ours, and reports the offset', () => {
    const caller = createCaller(0, () => 0.5)
    caller.heard = [
      { calledAt: 1000, offsetMs: 20 },
      { calledAt: 3000, offsetMs: 20 },
    ]
    const { r, offsetMs, count } = agreement(caller, 3100)
    expect(r).toBeCloseTo(1, 5)
    expect(offsetMs).toBeCloseTo(20, 5)
    expect(count).toBe(2)
  })

  it('is near 0 when calls are spread round the cycle', () => {
    const caller = createCaller(0, () => 0.5)
    const quarter = caller.period / 4
    caller.heard = [0, 1, 2, 3].map((n) => ({ calledAt: 1000, offsetMs: n * quarter }))
    expect(agreement(caller, 1100).r).toBeLessThan(1e-9)
  })
})

describe('the detector clock', () => {
  it('unwraps the counter into one continuous time', () => {
    const clock = createClock(48000)
    expect(clock(WRAP - 48)).toBeCloseTo(((WRAP - 48) / 48000) * 1000, 6)
    expect(clock(48)).toBeCloseTo(((WRAP + 48) / 48000) * 1000, 6)
  })
})

describe('the call', () => {
  it('is the call ssp_call plays, which ssp_call_listen is built to hear', () => {
    // The listener's bands are literals in its .scd, so they cannot be read
    // here; the call's frozen controls can, and the .scd says they must match.
    const frozen = Object.fromEntries(contract.frozen.map(({ name, value }) => [name, value]))
    expect(frozen['from']).toBeCloseTo(CALL.from, 3)
    expect(frozen['to']).toBeCloseTo(CALL.to, 3)
    expect(frozen['dur']! * 1000).toBeCloseTo(CALL.durMs, 3)
  })
})
