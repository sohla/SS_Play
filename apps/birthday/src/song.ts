import type { GridEvent } from '@ss/engine'
import { onsetAt, scaleOf, soundingAt, type Chord } from './harmony.ts'
import type { Gesture } from './mapping.ts'
import type { Pattern } from './pattern.ts'

export const midiToFreq = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

const dbamp = (db: number) => 10 ** (db * 0.05)

/** Where in the loop an absolute grid step falls. Negative-safe, for completeness. */
export const positionOf = (pattern: Pattern, step: number) =>
  ((step % pattern.loopSteps) + pattern.loopSteps) % pattern.loopSteps

/**
 * The melody, exactly as the file has it, on every pass.
 *
 * Nothing reads the phone here. The tune is the fixed point the descant moves
 * around, and it plays from boot whether anything is moving or not.
 */
export function melodyAt(pattern: Pattern, step: number): GridEvent[] {
  const note = onsetAt(pattern, positionOf(pattern, step))
  if (!note) return []

  const length = (note.steps * pattern.stepMs) / 1000
  return [
    {
      def: 'ssp_mel',
      // Released just short of the next note, so repeated notes — the two Cs of
      // every "Hap-py" — are heard as two.
      sustain: length * 0.9,
      controls: {
        freq: midiToFreq(note.midi),
        amp: 0.4,
        attack: 0.02,
        decay: 0.15,
        susLevel: 0.6,
        release: 0.25,
      },
    },
  ]
}

/**
 * Sixteenths between descant notes, by energy: silent, then quarters, eighths,
 * sixteenths. Each divides the beat, so a change of density never pulls the line
 * off it.
 */
export const DENSITIES = [0, 4, 2, 1] as const

/** Energy below which the descant is silent and the melody plays alone. */
export const SILENT_BELOW = 0.06

/** The descant's own memory, between steps. Also what the readout shows. */
export interface Descant {
  /** Last note played, MIDI. 0 before the first. */
  last: number
  /** 1 climbing, -1 falling. */
  direction: 1 | -1
  /** Sixteenths between notes right now; 0 is silent. */
  every: number
  /** The chord under the current bar. */
  chord: string
  /** Which of REGISTERS the line is in. */
  register: string
}

export const freshDescant = (): Descant => ({
  last: 0,
  direction: 1,
  every: 0,
  chord: '',
  register: '',
})

/**
 * The octaves tilt chooses between, low to high, as octaves below the line that
 * sits over the melody.
 *
 * Two go under the tune and none through it: the octave below the descant would
 * put the line in the melody's own register, where it stops being a second voice
 * and starts being a second melody.
 */
export const REGISTERS = [
  { name: 'bass', octavesDown: 3 },
  { name: 'tenor', octavesDown: 2 },
  { name: 'descant', octavesDown: 0 },
] as const

export const registerAt = (height: number) =>
  REGISTERS[Math.min(REGISTERS.length - 1, Math.floor(height * REGISTERS.length))] as
    (typeof REGISTERS)[number]

/**
 * A line around the melody that only ever plays notes that fit with it.
 *
 * The harmony is PyTrackMusic's rule at its simplest: **chord tones on the beat,
 * scale tones between** — so at sixteenths the line runs through passing notes,
 * and at quarters it is a pure arpeggio. The pool is rebuilt every bar from that
 * bar's chord, which is beatsLab's pool-per-bar.
 *
 * Two further rules keep it out of the melody's way:
 *
 * - **Never across it.** Above, the floor is a step over the tune's highest note;
 *   below, the ceiling is a step under its lowest. Tilt picks the octave, and in
 *   none of them do the two cross, so the melody stays the melody.
 * - **No semitone against it.** A note a semitone from whatever the melody is
 *   sounding is skipped — the one clash a chord tone can still make, as when the
 *   melody's E passes under the I chord's F.
 *
 * And one that makes it a conversation rather than a second melody: where the
 * tune moves, the descant drops back; where the tune holds a long note, the
 * descant comes forward to fill it.
 *
 * The walk is a scan, not a random choice: the next pool note in the direction
 * of travel, turning at the edges — an arpeggio up and down the chord. In the
 * bass it lands on the chord's root at every bar line, which is what makes it
 * a bass line rather than a low arpeggio.
 */
export function descantAt(
  pattern: Pattern,
  chords: readonly Chord[],
  step: number,
  gesture: Gesture,
  state: Descant,
): GridEvent[] {
  const position = positionOf(pattern, step)
  const chord = chords[Math.floor(position / pattern.stepsPerBar)] as Chord
  state.chord = chord.name

  state.every =
    gesture.energy < SILENT_BELOW
      ? 0
      : (DENSITIES[1 + Math.min(2, Math.floor(gesture.energy * 3))] as number)
  if (state.every === 0 || position % state.every !== 0) return []

  const onBeat = position % pattern.stepsPerBeat === 0
  const pool = onBeat ? chord.tones : scaleOf(pattern)

  const register = registerAt(gesture.height)
  state.register = register.name
  const above = Math.max(...pattern.notes.map((note) => note.midi)) + 2
  const below = Math.min(...pattern.notes.map((note) => note.midi)) - 1
  const floor = above - 12 * register.octavesDown
  let ceiling = floor + 7 + Math.round(gesture.span * 17)
  if (register.octavesDown > 0) ceiling = Math.min(ceiling, below)
  const melody = soundingAt(pattern, position)

  const candidates: number[] = []
  for (let midi = floor; midi <= ceiling; midi++) {
    if (!pool.includes(midi % 12)) continue
    if (melody && [1, 11].includes((((midi - melody.midi) % 12) + 12) % 12)) continue
    candidates.push(midi)
  }
  if (candidates.length === 0) return []

  const ahead = (direction: 1 | -1) =>
    direction === 1
      ? candidates.find((midi) => midi > state.last)
      : [...candidates].reverse().find((midi) => midi < state.last)

  let next = state.last === 0 ? candidates[0] : ahead(state.direction)
  if (next === undefined) {
    state.direction = state.direction === 1 ? -1 : 1
    next = ahead(state.direction) ?? (candidates[0] as number)
  }

  const root = chord.tones[0] as number
  if (register.name === 'bass' && position % pattern.stepsPerBar === 0) {
    // Searched over a whole octave rather than the window: at rest the window is
    // a fifth, which need not contain the root, and an octave always does.
    next = floor + ((((root - floor) % 12) + 12) % 12)
  }

  let amp = dbamp(-26 + gesture.energy * 14)
  // Call and response: back off on the tune's own onsets, so the words are clear.
  if (onsetAt(pattern, position)) amp *= 0.55

  let played = next
  if (gesture.accent) {
    played += 12
    amp *= 1.6
    gesture.accent = false
  }
  state.last = next

  const length = (state.every * pattern.stepMs) / 1000
  return [
    {
      def: 'ssp_moog',
      sustain: length * 0.7,
      controls: {
        freq: midiToFreq(played),
        amp,
        filterFreq: 400 * 2 ** (gesture.bright * 4),
        fq: 0.35,
        attack: 0.005,
        decay: 0.12,
        susLevel: 0.5,
        release: Math.min(0.4, length),
        pan: 0.3,
      },
    },
  ]
}
