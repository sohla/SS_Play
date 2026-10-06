import { ctl, i, type ControlValue } from './ctl.ts'
import type { Session } from './session.ts'

export interface ConductorOptions {
  session: Session
  /** SynthDef that runs the demand sequences and reports events. */
  clock: string
  /** SynthDef spawned once per event. */
  voice: string
  /** The address the clock's SendReply uses. */
  address: string
  /** Turn one event's values into the controls its voice is born with. */
  controls(values: readonly number[]): Record<string, number>
  /**
   * How long to hold the gate, in seconds, when the clock supplies one.
   *
   * Only needed for a personality whose Pbind used `\legato`, where the event
   * system held the gate for part of the step rather than letting the envelope
   * run out. Omit it and the voice frees itself.
   */
  sustainS?(values: readonly number[]): number | undefined
}

/**
 * A demand sequence in the server, spawning real voices through the page.
 *
 * This is the shape every ported AirKit personality takes. A `Pbind` cannot
 * become a Demand graph on its own because Demand cannot allocate nodes — so
 * the sequence stays in the server, where the audio clock keeps it exact, and
 * each event crosses to JavaScript to become an ordinary synth that frees
 * itself. The round trip costs a few milliseconds of scatter on the attack,
 * which is the price of polyphony and is inaudible on anything but a tight
 * rhythmic figure.
 */
export class Conductor {
  readonly #options: ConductorOptions
  readonly #group: number
  #clock: number | null = null
  #release: (() => void) | null = null
  #extra: Record<string, number> = {}
  #count = 0

  constructor(options: ConductorOptions) {
    this.#options = options
    const { session, clock, voice, address } = options

    this.#group = session.sonic.nextNodeId()
    session.sonic.send('/g_new', this.#group, 0, 0)

    this.#clock = session.sonic.nextNodeId()
    session.sonic.send('/s_new', clock, this.#clock, 0, 0)

    this.#release = session.dispatcher.on(address, (message) => {
      // SendReply arrives as [address, nodeId, replyId, ...values].
      const values = message.slice(3) as number[]
      if (values.length === 0) return

      const node = session.sonic.nextNodeId()
      session.sonic.send(
        '/s_new',
        voice,
        node,
        0,
        this.#group,
        ...ctl({ ...options.controls(values), ...this.#extra }),
      )
      this.#count += 1

      const hold = options.sustainS?.(values)
      if (hold === undefined) return

      // The gate is released rather than the node freed, so the envelope's
      // release stage runs — which for these voices is most of the sound.
      setTimeout(() => {
        try {
          session.sonic.send('/n_set', node, 'gate', i(0))
        } catch {
          // The engine may have gone while a note was sounding.
        }
      }, hold * 1000)
    })
  }

  /** Events spawned since boot. */
  get spawned(): number {
    return this.#count
  }

  /** Controls the phone holds, merged into every voice as it is born. */
  setVoiceControls(controls: Record<string, number>) {
    this.#extra = controls
  }

  /** Controls on the clock itself — the rate, and whether it runs at all. */
  setClock(controls: Record<string, ControlValue>) {
    if (this.#clock === null) return
    this.#options.session.sonic.send('/n_set', this.#clock, ...ctl(controls))
  }

  dispose() {
    this.#release?.()
    this.#release = null

    const { session } = this.#options
    try {
      if (this.#clock !== null) session.sonic.send('/n_set', this.#clock, 'gate', i(0))
      session.sonic.send('/n_free', this.#group)
    } catch {
      // The ordinary case on unload: the engine is already gone.
    }
    this.#clock = null
  }
}
