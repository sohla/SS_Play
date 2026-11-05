/**
 * `chorus`: devices that call, listen for each other's calls, and fall into step.
 *
 * ## The model
 *
 * Kuramoto's oscillators see each other's phase continuously. Fireflies and
 * crickets do not — they get a brief pulse and nothing between — so this is the
 * pulse-coupled form (Mirollo & Strogatz, 1990). Each device runs a phase from 0
 * to 1 and calls when it reaches 1. Hearing another call at phase φ moves it by
 *
 *     Δφ = −ε · sin(2πφ)
 *
 * which is Kuramoto's `sin(θj − θi)` evaluated at the one instant the other
 * oscillator is known: θj = 0, when it calls. Late in the cycle the term is
 * positive — the other is ahead, so call sooner. Early, it is negative — they
 * are behind, so wait.
 *
 * Phase alone locks devices with different natural periods at a fixed lag, so
 * the period adapts too (Ermentrout, 1991, after *Pteroptyx* fireflies): each
 * correction also nudges the period the same way, and the group converges on a
 * tempo rather than only a phase.
 *
 * ## Hearing yourself
 *
 * Between a device deciding to call and its detector hearing a call there is
 * output latency, input latency and the detector's own 80ms — on phones
 * anything from tens to a couple of hundred milliseconds. Uncorrected, a delay
 * in pulse coupling pulls the group into *anti*-phase.
 *
 * So each device listens to itself. Its own call comes back at
 * `delay = heard − scheduled`, measured over its first few calls, and that one
 * number does
 * both jobs: a detection at the predicted echo is ignored as its own, and any
 * other detection is moved back by the same delay to estimate when it was
 * *called* — which assumes the other device's output latency is close to this
 * one's. Where it is not, the pair settles that far apart and no further.
 *
 * Everything here is plain numbers in wall-clock milliseconds, with no audio,
 * so a room of devices can be simulated in a unit test.
 */

/** The call, as `ssp_call` plays it and `ssp_call_listen` is built to hear it. */
export const CALL = { from: 5000, to: 2500, durMs: 80 } as const

/** The tempo every device starts near: one call every two seconds. */
export const BASE_PERIOD_MS = 2000
/** How far either side of it a device starts, so there is something to converge. */
export const SPREAD = 0.08
export const PERIOD_MIN_MS = 1500
export const PERIOD_MAX_MS = 2600

/** ε. Small on purpose: the brief is *slowly* synchronise. */
export const COUPLING = 0.06
/** How much of each phase correction also goes into the period. */
export const ADAPT = 0.05

/**
 * A detection this close to a predicted echo of our own call is that echo.
 *
 * Also the closest two devices can usefully get: a neighbour inside it cannot be
 * told from our own call, so it is not coupled to.
 */
export const SELF_WINDOW_MS = 12
/** Before the delay is known: a detection arriving this long after we called may be us. */
export const PROBE_MS = [10, 800] as const
/**
 * While the delay is unknown, each call is moved by up to this fraction of a
 * period, at random.
 *
 * Our own echo comes back the same time after every call wherever the call
 * falls; a neighbour's does not. Without this, two devices of nearly equal
 * tempo hold a near-constant offset for many calls, the neighbour passes the
 * agreement test, and a device that took it for its own echo couples to itself.
 */
export const PROBE_JITTER = 0.25
/** Self-delay samples that must agree, within `AGREE_MS`, before the delay is trusted. */
export const AGREE = 3
export const AGREE_MS = 8

/** Never call sooner than this fraction of a period after the last call, however hard pulled. */
const REFRACTORY = 0.3
/** Own call times kept, to recognise echoes that arrive after the next call is committed. */
const KEEP_FIRES = 4
const KEEP_DELAYS = 7

export interface Heard {
  /** Estimated wall-clock time the other device called. */
  calledAt: number
  /** Its offset from our nearest call, ms. Negative: they called first. */
  offsetMs: number
}

export interface Caller {
  random: () => number
  period: number
  /** The next call, in wall ms. Not yet sent, so still free to move. */
  next: number
  /** Recent calls already sent. */
  fires: number[]
  /** Detector time minus scheduled time for our own call. Null until measured. */
  delay: number | null
  delays: number[]
  heard: Heard[]
}

export function createCaller(now: number, random: () => number = Math.random): Caller {
  const period = BASE_PERIOD_MS * (1 + SPREAD * (2 * random() - 1))
  return {
    random,
    period,
    next: now + random() * period,
    fires: [],
    delay: null,
    delays: [],
    heard: [],
  }
}

/**
 * The call to send now, if the next one falls before `horizon`.
 *
 * Sending commits it: from here on the call is in a timetagged bundle, so later
 * corrections move the one after.
 */
export function due(caller: Caller, horizon: number): number | null {
  if (caller.next > horizon) return null
  const at = caller.next
  caller.fires.push(at)
  if (caller.fires.length > KEEP_FIRES) caller.fires.shift()
  const probing = caller.delay === null ? PROBE_JITTER * (2 * caller.random() - 1) : 0
  caller.next = at + caller.period * (1 + probing)
  return at
}

export type Verdict = 'self' | 'calibrating' | 'other' | 'early'

/**
 * A detection, at `detectorMs` on the detector's own clock, which reached the
 * page at `receivedAt` wall time.
 *
 * The two clocks are different and neither is converted to the other: our own
 * call is what ties them, since `detectorMs − scheduled` is the same for every
 * one of our calls. `receivedAt` is only used before that is known, to find the
 * candidates — the message's own lateness is too jittery for anything finer.
 */
export function hear(caller: Caller, detectorMs: number, receivedAt: number): Verdict {
  if (caller.delay === null) return calibrate(caller, detectorMs, receivedAt)

  const calledAt = detectorMs - caller.delay
  const own = caller.fires.find((at) => Math.abs(calledAt - at) < SELF_WINDOW_MS)
  // Recognised, and not learned from. The delay is fixed once measured: it is
  // the device's own latency, which does not change in a session, and once the
  // group is close every neighbour's call lands on our echo — refining from
  // those walks the estimate by their offset, and the group drifts with it.
  if (own !== undefined) return 'self'

  const last = [...caller.fires].reverse().find((at) => at <= calledAt)
  if (last === undefined) return 'early'

  couple(caller, calledAt, last)
  return 'other'
}

function calibrate(caller: Caller, detectorMs: number, receivedAt: number): Verdict {
  const last = caller.fires.at(-1)
  if (last === undefined) return 'early'
  const since = receivedAt - last
  if (since < PROBE_MS[0] || since > PROBE_MS[1]) return 'calibrating'

  remember(caller, detectorMs - last)
  const recent = caller.delays.slice(-AGREE)
  if (recent.length === AGREE && Math.max(...recent) - Math.min(...recent) < AGREE_MS) {
    caller.delay = median(recent)
  }
  return 'calibrating'
}

function remember(caller: Caller, delay: number) {
  caller.delays.push(delay)
  if (caller.delays.length > KEEP_DELAYS) caller.delays.shift()
}

function couple(caller: Caller, calledAt: number, last: number) {
  const phase = (((calledAt - last) / caller.period) % 1 + 1) % 1
  const shift = -COUPLING * Math.sin(2 * Math.PI * phase)

  caller.next = Math.max(caller.next - shift * caller.period, last + REFRACTORY * caller.period)
  caller.period = Math.min(
    PERIOD_MAX_MS,
    Math.max(PERIOD_MIN_MS, caller.period * (1 - ADAPT * shift)),
  )

  // Signed distance to our nearest call, in either direction.
  const nearest = caller.fires.reduce((best, at) =>
    Math.abs(calledAt - at) < Math.abs(calledAt - best) ? at : best,
  )
  caller.heard.push({ calledAt, offsetMs: calledAt - nearest })
}

/**
 * How tightly the calls heard lately cluster around our own, as Kuramoto's
 * order parameter: r = |mean e^{iθ}|, 1 when every call lands on ours and near 0
 * when they are spread round the cycle. Also the mean offset, in ms.
 */
export function agreement(caller: Caller, now: number): { r: number; offsetMs: number; count: number } {
  const recent = caller.heard.filter(({ calledAt }) => now - calledAt < 2 * caller.period)
  caller.heard = recent
  if (recent.length === 0) return { r: 0, offsetMs: 0, count: 0 }

  let x = 0
  let y = 0
  for (const { offsetMs } of recent) {
    const theta = (2 * Math.PI * offsetMs) / caller.period
    x += Math.cos(theta)
    y += Math.sin(theta)
  }
  x /= recent.length
  y /= recent.length
  return {
    r: Math.hypot(x, y),
    offsetMs: (Math.atan2(y, x) / (2 * Math.PI)) * caller.period,
    count: recent.length,
  }
}

/** Our phase now, 0..1, for drawing. */
export function phaseAt(caller: Caller, now: number): number {
  const last = caller.fires.at(-1)
  if (last === undefined || now < last) return 0
  return Math.min(1, (now - last) / (caller.next - last))
}

/**
 * The detector's sample counter, unwrapped into milliseconds.
 *
 * `ssp_call_listen` wraps it at 2^22 so a float32 holds it exactly. Messages
 * arrive in order and far more often than once per wrap, so a counter smaller
 * than the last is the next lap.
 *
 * `originMs` is the wall time the listener started, give or take a block. The
 * model does not need it — it only ever takes differences on this clock — but
 * with it the self-delay reads as the latency it is.
 */
export const WRAP = 2 ** 22

export function createClock(sampleRate: number, originMs = 0) {
  let laps = 0
  let last = -1
  return (frame: number): number => {
    if (frame < last) laps += 1
    last = frame
    return originMs + ((laps * WRAP + frame) / sampleRate) * 1000
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
