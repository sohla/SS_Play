import type { MidiSong } from './midi.ts'

/** One note of the melody, on the sixteenth-note grid. */
export interface PatternNote {
  /** Sixteenths from the downbeat of the loop's first bar. */
  step: number
  /** Length in sixteenths. */
  steps: number
  midi: number
}

/**
 * A melody as a loop of sixteenths — what the MIDI file becomes.
 *
 * Steps rather than seconds, because the page plays it on `GridConductor`'s
 * absolute grid: step `k` of the wall clock is step `k % loopSteps` of the song,
 * so every device is at the same place in it.
 */
export interface Pattern {
  /** Milliseconds per sixteenth, from the file's tempo. */
  stepMs: number
  /** Sixteenths per beat of the meter: 4 in 3/4, 2 in 6/8. */
  stepsPerBeat: number
  stepsPerBar: number
  /** A whole number of bars. */
  loopSteps: number
  /** Pitch class of the tonic, 0 = C. */
  tonic: number
  minor: boolean
  notes: PatternNote[]
}

/** Sixteenths, the finest value Happy Birthday needs — its dotted rhythm is 3 + 1. */
const STEPS_PER_QUARTER = 4

/**
 * Turn a parsed MIDI file into a loop that starts on a downbeat.
 *
 * A MIDI file carries no bar lines, and LilyPond writes a pickup as notes from
 * tick zero — so "Hap-py" arrives as if it were the downbeat. The bar is found
 * by trying each beat as the place the file starts and keeping the one that puts
 * the most held time on downbeats, which is where a melody puts its long notes.
 *
 * The pickup then rotates to the end of the loop, where it fills the beat the
 * final bar leaves empty. Played round, the last "you" is followed by the next
 * "Hap-py" with no gap and no extra bar, which is how the song is sung.
 */
export function patternFrom(song: MidiSong): Pattern {
  const stepTicks = song.ppq / STEPS_PER_QUARTER
  const [beats, unit] = song.meter
  const stepsPerBeat = (STEPS_PER_QUARTER * 4) / unit
  const stepsPerBar = beats * stepsPerBeat

  const raw = song.notes.map((note) => {
    if (note.tick % stepTicks !== 0 || note.ticks % stepTicks !== 0) {
      throw new Error(`A note at tick ${note.tick} does not sit on the sixteenth grid`)
    }
    return { step: note.tick / stepTicks, steps: note.ticks / stepTicks, midi: note.midi }
  })

  const end = Math.max(...raw.map((note) => note.step + note.steps))
  const loopSteps = Math.ceil(end / stepsPerBar) * stepsPerBar

  let best = { shift: 0, weight: -1 }
  for (let beat = 0; beat < beats; beat++) {
    const shift = beat * stepsPerBeat
    const weight = raw
      .filter((note) => (note.step + shift) % stepsPerBar === 0)
      .reduce((sum, note) => sum + note.steps, 0)
    if (weight > best.weight) best = { shift, weight }
  }

  const notes = raw
    .map((note) => ({ ...note, step: (note.step + best.shift) % loopSteps }))
    .sort((a, b) => a.step - b.step)

  const major = (((song.key.accidentals * 7) % 12) + 12) % 12

  return {
    stepMs: 60_000 / song.bpm / STEPS_PER_QUARTER,
    stepsPerBeat,
    stepsPerBar,
    loopSteps,
    tonic: song.key.minor ? (major + 9) % 12 : major,
    minor: song.key.minor,
    notes,
  }
}
