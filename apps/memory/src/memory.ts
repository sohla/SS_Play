/**
 * A ten-second memory of the microphone's onsets, played back on a loop and
 * dissolving as it goes.
 *
 * Every onset the detector reports becomes a note at its place in the loop. Each
 * time the loop comes round, every note that has played loses some of its life,
 * by a random share of the dissolve rate — so they fade unevenly, the pattern
 * thins out into fragments rather than all dimming together, and there is room
 * for new notes. A note at no life is gone.
 *
 * Plain data and arithmetic: no audio and no React, so it can be tested.
 */

export const LOOP_S = 10
const LOOP_MS = LOOP_S * 1000

/** Past this, the faintest notes make room. A phone plays this many at once without trouble. */
export const MAX_NOTES = 48

/** Below this the mic's peak plays as silence; 0dB plays at the synth's full level. */
const FLOOR_DB = -50

/** The note an onset without a pitch plays: a clap, a knock, a consonant. Middle C. */
export const UNPITCHED = 60

export interface Note {
  /** Seconds into the loop. */
  at: number
  /** The mic's peak level at this onset, 0..1. */
  peak: number
  midi: number
  /** 1 when heard, 0 when gone. */
  life: number
  /** False until it has been played once: a note is not dissolved before it has been heard back. */
  played: boolean
}

/** An onset's pitch, to the nearest semitone, or `UNPITCHED`. */
export function midiOf(freq: number, hasFreq: number): number {
  if (hasFreq < 0.5 || !(freq > 0)) return UNPITCHED
  return Math.round(69 + 12 * Math.log2(freq / 440))
}

/** How loud a note plays, 0..1, before the synth's own level. */
export function ampOf(note: Note): number {
  const db = note.peak > 0 ? 20 * Math.log10(note.peak) : -Infinity
  return note.life * Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB))
}

/**
 * The detector's sample counter, as wall-clock milliseconds.
 *
 * `ssp_onset_listen` wraps the counter at 2^22, 87 seconds at 48kHz, and a quiet room
 * can go longer than that between onsets, so the lap is not counted from the
 * messages, as /chorus/ does with its steady stream, but recovered from when
 * this one arrived: the lap that puts the onset just before its message.
 */
export const WRAP = 2 ** 22

export function frameToMs(frame: number, receivedMs: number, originMs: number, sampleRate: number): number {
  const receivedFrames = ((receivedMs - originMs) / 1000) * sampleRate
  const laps = Math.max(0, Math.round((receivedFrames - frame) / WRAP))
  return originMs + ((laps * WRAP + frame) / sampleRate) * 1000
}

/** One pass of dissolving: every note that has played loses `rate` × a random 0.5..1.5 of its life. */
export function dissolve(notes: readonly Note[], rate: number, random: () => number = Math.random): Note[] {
  return notes
    .map((note) => (note.played ? { ...note, life: note.life - rate * (0.5 + random()) } : note))
    .filter((note) => note.life > 0)
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

  constructor(anchorMs: number) {
    this.#anchor = anchorMs
    this.#cursor = anchorMs
  }

  /** Where in the loop an instant falls, in seconds. */
  positionOf(ms: number): number {
    return ((((ms - this.#anchor) % LOOP_MS) + LOOP_MS) % LOOP_MS) / 1000
  }

  hear(ms: number, peak: number, midi: number) {
    this.notes.push({ at: this.positionOf(ms), peak, midi, life: 1, played: false })
    if (this.notes.length > MAX_NOTES) {
      const faintest = this.notes.reduce((low, note, index) =>
        ampOf(note) < ampOf(this.notes[low]!) ? index : low, 0)
      this.notes.splice(faintest, 1)
    }
  }

  due(horizonMs: number, rate: number, random: () => number = Math.random): Due[] {
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
        this.notes = dissolve(this.notes, rate, random)
      }
    }
    return out.sort((a, b) => a.ms - b.ms)
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
