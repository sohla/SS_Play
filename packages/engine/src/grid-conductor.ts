import { ctl, i } from './ctl.ts'
import type { Session } from './session.ts'

/** The OSC codec, which is a static on the SuperSonic class rather than the instance. */
interface OscCodec {
  encodeSingleBundle(timeTag: number, address: string, args: unknown[]): Uint8Array
  ntpNow(): number
  NTP_EPOCH_OFFSET: number
}

/** Seconds between 1900 and 1970, the offset an OSC timetag is measured from. */
export const NTP_EPOCH_OFFSET = 2_208_988_800

/**
 * The wall clock the engine's own timetags are built from.
 *
 * `performance.timeOrigin` is the Unix time at which this document's clock was
 * anchored, and `performance.now()` is the monotonic time since. Their sum is
 * wall-clock Unix milliseconds at sub-millisecond resolution — and it is the
 * expression SuperSonic's `ntpNow()` uses, which is the whole reason to use it
 * here rather than `Date.now()`: **the grid and the scheduler cannot disagree
 * about what time it is.**
 *
 * Two further differences from `Date.now()`, both wanted:
 *
 * - **It is monotonic.** An NTP correction mid-session steps `Date.now()`, which
 *   would shift the grid under a rhythm that is already playing. This stays on
 *   the anchor taken at load, so a correction is picked up on the next reload
 *   and never as a jump.
 * - **It has resolution.** `Date.now()` is integer milliseconds; this is a
 *   double, so a step boundary is not quantised on the way in.
 */
export function wallClockMs(): number {
  return performance.timeOrigin + performance.now()
}

/**
 * The absolute grid step containing a wall-clock instant.
 *
 * The grid is anchored at the **Unix epoch**, not at page load, and that is the
 * entire trick: every device computes the same step index for the same instant
 * without exchanging a single message. There is nothing to negotiate, no master
 * to elect and no server to run — two phones that agree about the time agree
 * about the beat.
 *
 * Which also means the clock *is* the sync, and its error is the instrument's
 * error. On wi-fi with automatic time a phone is typically within 1-10ms of
 * true; on a cellular connection measured offsets run to a mean of ~190ms and
 * have been seen past 800ms. That is a beat and a half at 120bpm, so a device
 * can be confidently, exactly one beat out and still be working perfectly.
 */
export function stepAt(wallMs: number, stepMs: number): number {
  return Math.floor(wallMs / stepMs)
}

/** The wall-clock instant a grid step begins. */
export function stepStartMs(step: number, stepMs: number): number {
  return step * stepMs
}

/** One voice on one step. Several may land on the same step. */
export interface GridEvent {
  /** SynthDef to play. */
  def: string
  /** Controls for this one event. */
  controls: Record<string, number>
  /** Seconds to hold the gate, if the def has one worth releasing. */
  sustain?: number
}

export interface GridConductorOptions {
  session: Session
  /** Milliseconds per step. Step `k` begins at Unix epoch + `k * stepMs`. */
  stepMs: number
  /** What sounds on an absolute step index. Empty for a rest. */
  eventsFor(step: number): readonly GridEvent[]
  /** How far ahead to schedule, in seconds. */
  lookaheadS?: number
  /** How often to top up the queue, in seconds. */
  intervalS?: number
}

/**
 * A sequence on an absolute grid shared by every device, with no coordination.
 *
 * The third way to run a pattern here, and it exists because the other two
 * cannot do this one thing.
 *
 * A `Conductor` is a Demand graph in the server: perfect time, and its phase
 * starts whenever the synth was created. A `ClientConductor` chains events by
 * adding each one's `dur` to the last, so its phase starts whenever `start()`
 * was called. **Both keep excellent time against themselves and no time at all
 * against another device** — two phones that began a second apart stay a second
 * apart for ever.
 *
 * This indexes `floor(wallClock / stepMs)` instead. The phase comes from the
 * clock rather than from the start, so:
 *
 * - two devices play in step without exchanging anything
 * - joining late lands in phase rather than offset by however late it was
 * - a stall resumes in phase, having silently dropped the steps it missed,
 *   rather than catching up in a burst or limping along a beat behind
 *
 * The cost is that the clock is now load-bearing. See `stepAt` for what that
 * means in milliseconds.
 */
export class GridConductor {
  readonly #session: Session
  readonly #options: Required<Omit<GridConductorOptions, 'session' | 'eventsFor'>>
  readonly #eventsFor: (step: number) => readonly GridEvent[]
  readonly #group: number
  readonly #osc: OscCodec

  #timer: ReturnType<typeof setInterval> | null = null
  /** The next step not yet scheduled. Absolute, not relative to start. */
  #nextStep = 0
  #count = 0
  #skipped = 0

  constructor(options: GridConductorOptions) {
    const { session, stepMs, eventsFor, lookaheadS = 0.12, intervalS = 0.025 } = options

    if (!(stepMs > 0)) throw new RangeError(`stepMs must be positive, got ${stepMs}`)

    this.#session = session
    this.#eventsFor = eventsFor
    this.#options = { stepMs, lookaheadS, intervalS }

    const codec = (session.sonic as unknown as { constructor: { osc?: OscCodec } }).constructor.osc
    if (!codec?.encodeSingleBundle || !codec.ntpNow) {
      throw new Error('This build of SuperSonic has no OSC bundle codec to schedule with')
    }
    this.#osc = codec

    this.#group = session.sonic.nextNodeId()
    session.sonic.send('/g_new', this.#group, 0, 0)
  }

  /** Events sent since construction. */
  get spawned(): number {
    return this.#count
  }

  /**
   * Steps that fell due while the thread was elsewhere and were dropped.
   *
   * Worth showing on a page whose purpose is to measure sync: a non-zero count
   * is the main thread stalling, which is a different fault from a clock being
   * wrong and would otherwise look identical.
   */
  get skipped(): number {
    return this.#skipped
  }

  get running(): boolean {
    return this.#timer !== null
  }

  /** The absolute step index sounding now. The number two devices compare. */
  stepNow(): number {
    return stepAt(wallClockMs(), this.#options.stepMs)
  }

  start() {
    if (this.#timer) return
    // The next step boundary, not "now plus a lookahead": starting mid-step
    // must not shift the grid, which is the entire point of the thing.
    this.#nextStep = this.stepNow() + 1
    this.#timer = setInterval(() => this.#fill(), this.#options.intervalS * 1000)
    this.#fill()
  }

  stop() {
    if (!this.#timer) return
    clearInterval(this.#timer)
    this.#timer = null
  }

  #fill() {
    const { lookaheadS } = this.#options
    const nowNtp = this.#osc.ntpNow()
    const horizon = nowNtp + lookaheadS

    // Behind by more than a lookahead means the thread was away — a backgrounded
    // tab, a long task. Skip to the present rather than scheduling the past: a
    // burst of everything missed is worse than a gap, and on a grid the missed
    // steps are gone rather than owed.
    const current = this.stepNow()
    if (this.#nextStep < current) {
      this.#skipped += current - this.#nextStep
      this.#nextStep = current + 1
    }

    // A guard, not a feature: a tiny stepMs against a long lookahead would
    // otherwise spin here.
    let budget = 256

    while (this.#ntpOf(this.#nextStep) < horizon && budget-- > 0) {
      const at = this.#ntpOf(this.#nextStep)
      // Only ever schedule forwards. A step that came due inside this very
      // call is already late, and scsynth plays a past timetag immediately —
      // which would be an event out of its own grid slot.
      if (at >= nowNtp) {
        for (const event of this.#eventsFor(this.#nextStep)) this.#emit(at, event)
      } else {
        this.#skipped += 1
      }
      this.#nextStep += 1
    }
  }

  /** The OSC timetag for an absolute step. */
  #ntpOf(step: number): number {
    return stepStartMs(step, this.#options.stepMs) / 1000 + this.#osc.NTP_EPOCH_OFFSET
  }

  #emit(at: number, event: GridEvent) {
    const node = this.#session.sonic.nextNodeId()

    this.#session.sonic.sendOSC(
      this.#osc.encodeSingleBundle(at, '/s_new', [
        event.def,
        i(node),
        i(0),
        i(this.#group),
        ...ctl(event.controls),
      ]),
    )
    this.#count += 1

    if (event.sustain === undefined) return

    this.#session.sonic.sendOSC(
      this.#osc.encodeSingleBundle(at + event.sustain, '/n_set', [i(node), 'gate', i(0)]),
    )
  }

  dispose() {
    this.stop()
    try {
      this.#session.sonic.send('/n_free', this.#group)
    } catch {
      // The ordinary case on unload: the engine is already gone.
    }
  }
}
