import { ctl, i, type Session } from '@ss/engine'

export const CLOCK = 'ssp_drop_clock'
export const DROP = 'ssp_drop'
export const VERB = 'ssp_drop_verb'

/**
 * A private stereo bus for the drops to play into.
 *
 * scsynth's hardware buses come first — two out, two in, as pinned in
 * createSession — so anything from index 4 upward is private. 8 leaves room
 * for the hardware layout to change without this silently landing on an input.
 */
const FX_BUS = 8

/** Per-drop values chosen by the clock synth and sent back over OSC. */
export interface Drop {
  freq: number
  filterFreq: number
  filterRQ: number
  pan: number
}

/** What the phone writes, held here so a spawning drop can read the current values. */
export interface ShowerControls {
  amp: number
  decay: number
  wobble: number
  attack: number
}

/**
 * The node graph from `droplet.sc`, which already had the right shape:
 *
 *   group        the drops, each freeing itself on silence
 *   verb         after the group, reading the bus the drops write to
 *
 * The verb is added to the tail of the root group rather than into the drops'
 * group, so it is guaranteed to run after every drop however many are alive.
 */
export class Shower {
  readonly #session: Session
  readonly #group: number
  readonly #verb: number
  #clock: number | null = null
  #controls: ShowerControls

  constructor(session: Session, controls: ShowerControls) {
    this.#session = session
    this.#controls = controls

    this.#group = session.sonic.nextNodeId()
    session.sonic.send('/g_new', this.#group, 0, 0)

    this.#verb = session.sonic.nextNodeId()
    // addAction 1 is addToTail of the root group.
    session.sonic.send('/s_new', VERB, this.#verb, 1, 0, ...ctl({ in: i(FX_BUS) }))

    this.#clock = session.sonic.nextNodeId()
    session.sonic.send('/s_new', CLOCK, this.#clock, 0, 0)
  }

  /** The node the phone's controls are written to. */
  get clock(): number | null {
    return this.#clock
  }

  setControls(controls: ShowerControls) {
    this.#controls = controls
  }

  /**
   * Spawn one drop, from values the clock chose.
   *
   * The randomised values come from the server; the rest are whatever the phone
   * is holding right now. Splitting them this way is what keeps the sequence
   * exact while the gesture stays continuous.
   */
  spawn(drop: Drop) {
    const { amp, decay, wobble, attack } = this.#controls

    this.#session.sonic.send(
      '/s_new',
      DROP,
      this.#session.sonic.nextNodeId(),
      0,
      this.#group,
      ...ctl({
        out: i(FX_BUS),
        freq: drop.freq,
        filterFreq: drop.filterFreq,
        filterRQ: drop.filterRQ,
        pan: drop.pan,
        amp,
        decay,
        wobble,
        attack,
      }),
    )
  }

  setVerbRoom(room: number) {
    this.#session.sonic.send('/n_set', this.#verb, ...ctl({ room }))
  }

  dispose() {
    for (const node of [this.#clock, this.#verb]) {
      if (node === null) continue
      try {
        this.#session.sonic.send('/n_set', node, 'gate', i(0))
      } catch {
        // The engine may already be gone, which is the ordinary case on unload.
      }
    }
    this.#clock = null

    // Drops free themselves on silence, but any still ringing would outlive the
    // reverb that is fading — so the group goes too.
    try {
      this.#session.sonic.send('/n_free', this.#group)
    } catch {
      // As above.
    }
  }
}
