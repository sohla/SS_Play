import { ctl, i, type Session } from '@ss/engine'

export const DEF = 'ssp_touch'

/**
 * The shared controls, read from the SynthDef's contract at runtime.
 *
 * Deliberately not a fixed shape: naming the five fields here would be a second
 * place the def's parameters are written down, and the one that goes stale when
 * the def gains a control.
 */
export type VoiceParams = Record<string, number>

/**
 * One synth per finger, held for as long as the finger is.
 *
 * Every voice lives in a group of its own so a global parameter can be set on
 * the group rather than on each node: `/n_set` applied to a group reaches every
 * synth in it, which is what lets the cutoff slider move a chord that is
 * already sounding.
 */
export class Voices {
  readonly #session: Session
  readonly #group: number
  readonly #byPointer = new Map<number, { node: number; strip: number }>()

  constructor(session: Session) {
    this.#session = session
    this.#group = session.sonic.nextNodeId()
    // addAction 0, target 0: head of the root group.
    session.sonic.send('/g_new', this.#group, 0, 0)
  }

  get activeStrips(): number[] {
    return [...this.#byPointer.values()].map((voice) => voice.strip)
  }

  start(pointerId: number, strip: number, freq: number, amp: number, pan: number, params: VoiceParams) {
    // A pointer can only hold one voice. Without this, a pointerdown that never
    // saw its pointerup — which happens when a gesture is interrupted — would
    // leak a sounding note that nothing can reach to release.
    this.stop(pointerId)

    const node = this.#session.sonic.nextNodeId()
    this.#byPointer.set(pointerId, { node, strip })

    this.#session.sonic.send(
      '/s_new',
      DEF,
      node,
      0,
      this.#group,
      ...ctl({ freq, amp, pan, ...params }),
    )
  }

  /** Returns true when the strip changed, which is the only time the UI needs redrawing. */
  move(pointerId: number, strip: number, freq: number, amp: number, pan: number): boolean {
    const voice = this.#byPointer.get(pointerId)
    if (!voice) return false

    const moved = voice.strip !== strip
    voice.strip = strip

    // Sent on every pointermove, which is 60-120Hz per finger. It never touches
    // React state — the surface redraws only when `moved` says a different
    // strip is lit.
    this.#session.sonic.send('/n_set', voice.node, ...ctl({ freq, amp, pan }))
    return moved
  }

  stop(pointerId: number): boolean {
    const voice = this.#byPointer.get(pointerId)
    if (!voice) return false

    this.#byPointer.delete(pointerId)
    // Gate off, not /n_free: the release stage of the envelope is what frees
    // the node, so cutting it here would replace every release with a click.
    this.#session.sonic.send('/n_set', voice.node, 'gate', i(0))
    return true
  }

  /** Set a shared parameter on every sounding voice at once. */
  setParam(name: string, value: number) {
    this.#session.sonic.send('/n_set', this.#group, ...ctl({ [name]: value }))
  }

  /** Release everything. Used when the page is hidden mid-chord. */
  stopAll() {
    for (const pointerId of [...this.#byPointer.keys()]) this.stop(pointerId)
  }
}
