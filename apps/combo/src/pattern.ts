import type { LoadedSample, ScheduledEvent } from '@ss/engine'
import {
  BAR_S,
  BASS_DIVS,
  BASS_OCTAVE,
  DEGREES,
  KIT_DIVS,
  MELODY_DIVS,
  MELODY_OCTAVE,
  ROOTS,
  ROOT_FLOOR_S,
  TONIC,
  type Combo,
} from './mapping.ts'

export const midiToFreq = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

/**
 * What the three layers agree about.
 *
 * AirKit does this through `m.com.root`, a slot on the shared model that one
 * personality writes and the others read. There is no shared model here, so it is
 * one object the page owns and all three generators close over — the same idea at
 * page scale rather than rig scale.
 */
export interface Shared {
  /** Index into ROOTS. Moved by the kit, read by all three. */
  rootAt: number
  /** Seconds since the page started, as the conductors see it. */
  clock: number
  /** When the root last moved, so it cannot move again too soon. */
  rootMovedAt: number
}

export const freshShared = (): Shared => ({ rootAt: 0, clock: 0, rootMovedAt: -ROOT_FLOOR_S })

/** Semitones above the tonic, now. */
export const rootOf = (shared: Shared) => ROOTS[shared.rootAt % ROOTS.length] as number

/**
 * Move the root on, if a flick has earned it.
 *
 * `arialBass.sc`'s gate, with its numbers changed: movement over a threshold, and
 * a floor on how often. The floor is a whole bar here rather than 0.35 beats,
 * because this root is holding three layers together and one that moves on every
 * knock is not a root — it is a wobble.
 *
 * Called from the kit, which is the layer on the shortest step and therefore the
 * one that notices a flick soonest.
 */
export function maybeShiftRoot(shared: Shared, now: Combo): boolean {
  if (!now.wantsRootShift) return false
  if (shared.clock - shared.rootMovedAt < ROOT_FLOOR_S) return false

  shared.rootAt = (shared.rootAt + 1) % ROOTS.length
  shared.rootMovedAt = shared.clock
  return true
}

/** The kit, sorted short to long with the kick found by name — multiBeat4's idea. */
export interface Kit {
  buffers: number[]
  kickIdx: number
}

export function arrangeKit(samples: readonly LoadedSample[]): Kit {
  const sorted = [...samples].sort((a, b) => a.numFrames - b.numFrames)
  const kickIdx = sorted.findIndex((s) => /drum|kick|bd/i.test(s.name))
  return {
    buffers: sorted.map((s) => s.bufnum),
    kickIdx: kickIdx === -1 ? 0 : kickIdx,
  }
}

/** The piano, by the MIDI note each sample was recorded at. */
export interface Tone {
  bufnum: number
  midi: number
}

export function arrangePiano(samples: readonly LoadedSample[]): Tone[] {
  const NOTES = 'C C# D D# E F F# G G# A A# B'.split(' ')
  return samples
    .map((sample) => {
      const match = /_([A-G]#?)(\d)/.exec(sample.name)
      if (!match) return null
      const index = NOTES.indexOf(match[1] as string)
      if (index === -1) return null
      return { bufnum: sample.bufnum, midi: (Number(match[2]) + 1) * 12 + index }
    })
    .filter((one): one is Tone => one !== null)
    .sort((a, b) => a.midi - b.midi)
}

const nearest = (library: readonly Tone[], target: number) =>
  library.reduce((best, one) =>
    Math.abs(one.midi - target) < Math.abs(best.midi - target) ? one : best,
  )

/**
 * The kit layer, and the one that moves the root.
 *
 * Step 0 of every bar is the kick; the rest come from the short end of the
 * palette. The subdivision is read once per bar, as `Pswitch` does — a change
 * lands on the beat rather than halfway through one.
 */
export function kitPattern(
  kit: Kit,
  read: () => Combo,
  shared: Shared,
): () => ScheduledEvent | null {
  let step = 0
  let div = KIT_DIVS[0] as number
  let level = 0

  return () => {
    const now = read()

    if (step === 0) {
      div = KIT_DIVS[now.kitDiv] ?? (KIT_DIVS[0] as number)
      level = now.level
      // Once a bar, on the downbeat, and only if a flick has earned it. Doing it
      // here rather than in the page means the shift always lands on a beat.
      maybeShiftRoot(shared, now)
    }

    const dur = BAR_S / div
    const downbeat = step === 0
    const pick = downbeat
      ? kit.kickIdx
      : 1 + Math.floor(Math.random() * Math.max(1, kit.buffers.length - 1))

    step = (step + 1) % div
    shared.clock += dur

    return {
      def: 'ssp_kit',
      dur,
      // An adsr frees on the gate falling, so every event has to carry one.
      sustain: dur * 0.9,
      controls: {
        bufnum: kit.buffers[Math.min(pick, kit.buffers.length - 1)] as number,
        amp: level * (downbeat ? 1 : 0.5),
        rate: downbeat ? 1 : 0.9 + Math.random() * 0.3,
        release: dur * 0.8,
        sustain: 0.4,
        cutoff: downbeat ? 40 : 220,
        pan: downbeat ? 0 : Math.random() * 0.5 - 0.25,
      },
    }
  }
}

/**
 * The bass: root and fifth, an octave below the tonic.
 *
 * Two notes only, because its job is to say where home is while the melody moves
 * around it. The filter comes from rotation rather than from the level, so the
 * bass opens up when you turn the phone and not when you shake it — which is what
 * keeps a hard passage from also being a bright one.
 */
export function bassPattern(read: () => Combo, shared: Shared): () => ScheduledEvent | null {
  let step = 0
  let div = BASS_DIVS[0] as number

  return () => {
    const now = read()
    if (step === 0) div = BASS_DIVS[now.bassDiv] ?? (BASS_DIVS[0] as number)

    const dur = BAR_S / div
    // Root on the downbeat, fifth on the half when there is one.
    const degree = step === 0 ? 0 : 7
    const midi = TONIC + BASS_OCTAVE + rootOf(shared) + degree

    step = (step + 1) % div

    return {
      def: 'ssp_moog',
      dur,
      sustain: dur * 0.85,
      controls: {
        freq: midiToFreq(midi),
        amp: now.level * 0.5,
        filterFreq: now.filterFreq,
        fq: 0.35,
        attack: 0.01,
        decay: 0.12,
        susLevel: 0.75,
        release: dur * 0.6,
        pan: 0,
      },
    }
  }
}

/**
 * The melody: the pool, walked.
 *
 * The pool's *width* is rotation's, so turning the phone is the gesture that
 * decides how much of the mode is in play — three notes is nearly a drone over
 * the bass, seven is the whole thing. Which note within it comes from a walk
 * rather than a scan, so widening the pool changes what is available without
 * jumping the line to a new place in it.
 *
 * Octaves alternate on the bar so a narrow pool still moves.
 */
export function melodyPattern(
  library: readonly Tone[],
  read: () => Combo,
  shared: Shared,
  state: { last: { midi: number; shift: number } },
): () => ScheduledEvent | null {
  let step = 0
  let div = MELODY_DIVS[0] as number
  let at = 0
  let bar = 0
  let pool = 3

  return () => {
    const now = read()
    if (step === 0) {
      div = MELODY_DIVS[now.melodyDiv] ?? (MELODY_DIVS[0] as number)
      pool = now.pool
      bar += 1
    }

    // A walk, not a scan: ±1 through the pool with the odd rest on the spot, so
    // the line stays stepwise however wide the pool gets.
    at = Math.min(Math.max(at + (Math.floor(Math.random() * 3) - 1), 0), pool - 1)

    const degree = DEGREES[at % pool] as number
    const octave = bar % 2 === 0 ? 0 : 12
    const midi = TONIC + MELODY_OCTAVE + rootOf(shared) + degree + octave

    const sample = nearest(library, midi)
    const shift = midi - sample.midi
    const dur = BAR_S / div

    state.last = { midi, shift }
    step = (step + 1) % div

    return {
      def: 'ssp_piano',
      dur,
      controls: {
        bufnum: sample.bufnum,
        rate: 2 ** (shift / 12),
        amp: now.level * 0.45,
        // The piano's envelope has no gate; `sustain` is the middle segment's
        // length, so it is sent rather than left to a default.
        sustain: dur * 0.8,
        attack: 0.002,
        release: dur * 2,
        pan: 0.25,
      },
    }
  }
}
