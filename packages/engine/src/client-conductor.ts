import { ctl, i } from './ctl.ts'
import type { Session } from './session.ts'

/** The OSC codec, which is a static on the SuperSonic class rather than the instance. */
interface OscCodec {
  encodeSingleBundle(timeTag: number, address: string, args: unknown[]): Uint8Array
  ntpNow(): number
}

export interface ScheduledEvent {
  /** SynthDef to play. */
  def: string
  /** Controls for this one event. */
  controls: Record<string, number>
  /** Seconds until the next event. */
  dur: number
  /** Seconds to hold the gate, if the def has one worth releasing. */
  sustain?: number
}

export interface ClientConductorOptions {
  session: Session
  /** Produce the next event. Called ahead of time, not when it sounds. */
  nextEvent(): ScheduledEvent | null
  /** How far ahead to schedule, in seconds. */
  lookaheadS?: number
  /** How often to top up the queue, in seconds. */
  intervalS?: number
}

/**
 * A pattern that runs in JavaScript and schedules into the future.
 *
 * The other way to run a sequence, and the one that trades a different set of
 * costs than a Demand graph in the server.
 *
 * A Demand graph keeps perfect time because it *is* the audio clock, but it
 * cannot allocate a node, cannot read a value that changes shape, and three
 * interlocking streams in one have to be trusted to stay in step. This runs the
 * pattern in ordinary code — where a switch on a live index is a function call —
 * and buys the timing back with OSC bundle timetags: every event is encoded
 * with the time it should happen and sent before it needs to, so scsynth places
 * it to the sample rather than whenever a JavaScript timer happened to fire.
 *
 * Measured: a bundle asked for 400ms ahead sounds 400ms ahead, and one asked
 * for 200ms sounds at 200ms. The timer's own jitter never reaches the audio,
 * because the timer only decides *when to post*, never when to play.
 *
 * The lookahead is the one number that matters. Too short and a stalled main
 * thread leaves a gap; too long and the phone's movement stops reaching the
 * sound, because events are already committed. 120ms is roughly four frames of
 * tolerance against a tenth of a second of lag in the gesture.
 */
export class ClientConductor {
  readonly #session: Session
  readonly #options: Required<Omit<ClientConductorOptions, 'session' | 'nextEvent'>>
  readonly #nextEvent: () => ScheduledEvent | null
  readonly #group: number
  readonly #osc: OscCodec

  #timer: ReturnType<typeof setInterval> | null = null
  /** NTP seconds at which the next event falls due. */
  #nextAt = 0
  #count = 0

  constructor(options: ClientConductorOptions) {
    const { session, nextEvent, lookaheadS = 0.12, intervalS = 0.025 } = options

    this.#session = session
    this.#nextEvent = nextEvent
    this.#options = { lookaheadS, intervalS }

    const codec = (session.sonic as unknown as { constructor: { osc?: OscCodec } }).constructor.osc
    if (!codec?.encodeSingleBundle || !codec.ntpNow) {
      throw new Error('This build of SuperSonic has no OSC bundle codec to schedule with')
    }
    this.#osc = codec

    this.#group = session.sonic.nextNodeId()
    session.sonic.send('/g_new', this.#group, 0, 0)
  }

  get spawned(): number {
    return this.#count
  }

  get running(): boolean {
    return this.#timer !== null
  }

  start() {
    if (this.#timer) return
    // A beat ahead of now, so the first event is scheduled rather than late.
    this.#nextAt = this.#osc.ntpNow() + this.#options.lookaheadS
    this.#timer = setInterval(() => this.#fill(), this.#options.intervalS * 1000)
    this.#fill()
  }

  stop() {
    if (!this.#timer) return
    clearInterval(this.#timer)
    this.#timer = null
  }

  #fill() {
    const horizon = this.#osc.ntpNow() + this.#options.lookaheadS

    // A guard, not a feature: a pattern that returns a dur of zero would spin
    // here forever and take the main thread with it.
    let budget = 64

    while (this.#nextAt < horizon && budget-- > 0) {
      const event = this.#nextEvent()
      if (!event) break

      this.#emit(this.#nextAt, event)
      this.#nextAt += Math.max(event.dur, 0.005)
    }

    // Fell so far behind that catching up would be a burst of notes at once —
    // which is what a backgrounded tab does. Skip to the present instead.
    if (this.#nextAt < this.#osc.ntpNow()) {
      this.#nextAt = this.#osc.ntpNow() + this.#options.lookaheadS
    }
  }

  #emit(at: number, event: ScheduledEvent) {
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

    // The gate off is scheduled too, rather than left to a timer. A release
    // that drifts is less audible than an attack that does, but there is no
    // reason to accept either when the bundle costs the same.
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
