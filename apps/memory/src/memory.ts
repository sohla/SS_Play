/**
 * A three-second memory of the microphone's onsets, played back on a loop and
 * dissolving as it goes.
 *
 * Every onset the detector reports becomes a note at its place in the loop. Each
 * time the loop comes round, a set number of the notes that have played die,
 * picked at random — so the pattern breaks into fragments, and there is room for
 * new notes.
 *
 * Plain data and arithmetic: no audio and no React, so it can be tested.
 */

export const LOOP_S = 3
const LOOP_MS = LOOP_S * 1000

/** Past this, the faintest notes make room. A phone plays this many at once without trouble. */
export const MAX_NOTES = 48

/** Below this the mic's peak plays as silence and the lowest note; 0dB plays loudest and highest. */
const FLOOR_DB = -50

/** The notes loudness spans: the quietest onset plays `LOWEST`, the loudest `LOWEST + SPAN`. */
export const LOWEST = 48
export const SPAN = 36

/**
 * How long after each note the page plays it will not believe an onset.
 *
 * The loop comes out of the speaker and back into the mic, and the browser's
 * echo cancellation does not take the engine's output away, so without this
 * every note played back is heard again as a new one and the memory fills
 * itself. The window covers the trip out and back, which on a phone is tens to a
 * couple of hundred milliseconds. A real sound inside it is lost too.
 */
export const DEAF_MS = 250

export interface Note {
  /** Seconds into the loop. */
  at: number
  /** The mic's peak level at this onset, 0..1. */
  peak: number
  midi: number
  /** False until it has been played once: a note does not die before it has been heard back. */
  played: boolean
}

/** The peak, 0..1, from -50dB up. */
function loudness(peak: number): number {
  const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity
  return Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB))
}

/** An onset's note, from how loud it was, to the nearest semitone. */
export function midiOf(peak: number): number {
  return LOWEST + Math.round(loudness(peak) * SPAN)
}

/** How loud a note plays, 0..1, before the synth's own level. */
export function ampOf(note: Note): number {
  return loudness(note.peak)
}

/**
 * The detector's sample counter, as wall-clock milliseconds.
 *
 * `ssp_onset_listen` wraps the counter at 2^22, 87 seconds at 48kHz, and a quiet
 * room can go longer than that between onsets, so the lap is not counted from the
 * messages, as /chorus/ does with its steady stream, but recovered from when
 * this one arrived: the lap that puts the onset just before its message.
 */
export const WRAP = 2 ** 22

export function frameToMs(frame: number, receivedMs: number, originMs: number, sampleRate: number): number {
  const receivedFrames = ((receivedMs - originMs) / 1000) * sampleRate
  const laps = Math.max(0, Math.round((receivedFrames - frame) / WRAP))
  return originMs + ((laps * WRAP + frame) / sampleRate) * 1000
}

/** One pass of dissolving: `count` of the notes that have played die, picked at random. */
export function dissolve(notes: readonly Note[], count: number, random: () => number = Math.random): Note[] {
  const dying = new Set<Note>()
  const played = notes.filter((note) => note.played)
  while (dying.size < Math.min(count, played.length)) {
    const left = played.filter((note) => !dying.has(note))
    dying.add(left[Math.floor(random() * left.length)]!)
  }
  return notes.filter((note) => !dying.has(note))
}

export interface Due {
  /** Wall-clock milliseconds to play it at. */
  ms: number
  note: Note
}

/**
 * The loop, anchored at a wall-clock instant: pass 0 starts there.
 *
 * `due` is called ahead of time by a scheduler, as the engine's conductors are,
 * and hands back every note that falls before the horizon. Dissolving happens
 * as the scheduler crosses the end of a pass, so a note's next playing already
 * carries its loss.
 */
export class Loop {
  notes: Note[] = []
  readonly #anchor: number
  #cursor: number
  #pass = 0
  /** When the notes already sent will sound, oldest first, for `DEAF_MS`. */
  #sent: number[] = []

  constructor(anchorMs: number) {
    this.#anchor = anchorMs
    this.#cursor = anchorMs
  }

  /** Where in the loop an instant falls, in seconds. */
  positionOf(ms: number): number {
    return ((((ms - this.#anchor) % LOOP_MS) + LOOP_MS) % LOOP_MS) / 1000
  }

  /** Remember an onset, unless it is one of our own notes coming back. Says whether it was kept. */
  hear(ms: number, peak: number, midi: number): boolean {
    while (this.#sent.length && this.#sent[0]! < ms - DEAF_MS) this.#sent.shift()
    if (this.#sent.some((sent) => sent <= ms)) return false
    this.notes.push({ at: this.positionOf(ms), peak, midi, played: false })
    if (this.notes.length > MAX_NOTES) {
      const faintest = this.notes.reduce((low, note, index) => (note.peak < this.notes[low]!.peak ? index : low), 0)
      this.notes.splice(faintest, 1)
    }
    return true
  }

  due(horizonMs: number, dying: number, random: () => number = Math.random): Due[] {
    const out: Due[] = []
    while (this.#cursor < horizonMs) {
      const start = this.#anchor + this.#pass * LOOP_MS
      const end = Math.min(horizonMs, start + LOOP_MS)
      for (const note of this.notes) {
        const ms = start + note.at * 1000
        if (ms >= this.#cursor && ms < end) {
          note.played = true
          out.push({ ms, note: { ...note } })
        }
      }
      this.#cursor = end
      if (end === start + LOOP_MS) {
        this.#pass += 1
        this.notes = dissolve(this.notes, dying, random)
      }
    }
    out.sort((a, b) => a.ms - b.ms)
    this.#sent.push(...out.map((one) => one.ms))
    return out
  }

  /**
   * Skip to the present, as the conductors do after a stall: a backgrounded tab
   * would otherwise come back to a burst of every note it missed.
   */
  catchUp(nowMs: number) {
    if (this.#cursor >= nowMs) return
    this.#pass = Math.floor((nowMs - this.#anchor) / LOOP_MS)
    this.#cursor = nowMs
  }
}
