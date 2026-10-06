import { ctl, i } from './ctl.ts'
import type { Session } from './session.ts'

export interface HeldVoiceOptions {
  session: Session
  /** SynthDef held open for the life of the page. */
  def: string
  /** Controls it is born with. */
  initial?: Record<string, number>
}

/**
 * One synth, held open, with the phone moving its controls.
 *
 * The other half of how AirKit personalities are built. Some run a pattern and
 * spawn a voice per event — that is `Conductor`. Others hold a single voice for
 * the whole performance and do everything by changing it, which needs no
 * sequencer at all and is why those personalities have no `Pbind`.
 *
 * Worth keeping separate rather than folding into Conductor: a held voice has
 * no events, no polyphony and no step, so a shared abstraction would be mostly
 * branches on which kind it is.
 */
export class HeldVoice {
  readonly #session: Session
  #node: number | null = null

  constructor({ session, def, initial = {} }: HeldVoiceOptions) {
    this.#session = session
    this.#node = session.sonic.nextNodeId()
    session.sonic.send('/s_new', def, this.#node, 0, 0, ...ctl(initial))
  }

  get node(): number | null {
    return this.#node
  }

  set(controls: Record<string, number>) {
    if (this.#node === null) return
    this.#session.sonic.send('/n_set', this.#node, ...ctl(controls))
  }

  dispose() {
    if (this.#node === null) return
    try {
      // Gate off rather than /n_free: these voices have long releases, and
      // cutting the node would replace every one with a click.
      this.#session.sonic.send('/n_set', this.#node, 'gate', i(0))
    } catch {
      // The ordinary case on unload: the engine is already gone.
    }
    this.#node = null
  }
}
