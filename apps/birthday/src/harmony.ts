import type { Pattern, PatternNote } from './pattern.ts'

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]

/** The seven pitch classes of the pattern's key. */
export function scaleOf(pattern: Pattern): number[] {
  return (pattern.minor ? MINOR : MAJOR).map((step) => (step + pattern.tonic) % 12)
}

export interface Chord {
  /** Roman numeral, for the readout. */
  name: string
  /** Root, third and fifth as pitch classes, root first. */
  tones: number[]
}

/**
 * The primary triads only — I, IV and V, the three a song this plain is built on.
 *
 * Offering ii, iii and vi as well gets a cleverer answer and a worse one: the
 * second bar's D–C–F scores as well under vi as under I, and a reharmonised
 * Happy Birthday stops sounding like the one everybody knows.
 */
const PRIMARY = [
  { degree: 0, major: 'I', minor: 'i' },
  { degree: 3, major: 'IV', minor: 'iv' },
  { degree: 4, major: 'V', minor: 'v' },
]

const triadOn = (scale: number[], degree: number) =>
  [0, 2, 4].map((third) => scale[(degree + third) % 7] as number)

/**
 * One chord per bar, read from the melody rather than written in.
 *
 * Each bar's candidates are scored by how much of its sounding time — in
 * sixteenths, not note count — lands on a chord tone. On a tie the previous
 * bar's chord holds, which is what a player does with a neighbour note: the D in
 * "birth-day" scores I and IV level, and holding I is the textbook answer.
 *
 * PyTrackMusic does the same job with music21's Roman-numeral analysis; this is
 * that idea at the size of one melody.
 */
export function chordsPerBar(pattern: Pattern): Chord[] {
  const scale = scaleOf(pattern)
  const candidates = PRIMARY.map((one) => ({
    name: pattern.minor ? one.minor : one.major,
    tones: triadOn(scale, one.degree),
  }))

  const bars = pattern.loopSteps / pattern.stepsPerBar
  const chords: Chord[] = []
  let previous = candidates[0] as Chord

  for (let bar = 0; bar < bars; bar++) {
    const from = bar * pattern.stepsPerBar
    const inBar = pattern.notes.filter(
      (note) => note.step >= from && note.step < from + pattern.stepsPerBar,
    )
    const score = (chord: Chord) =>
      inBar
        .filter((note) => chord.tones.includes(note.midi % 12))
        .reduce((sum, note) => sum + note.steps, 0)

    let best = previous
    for (const chord of candidates) if (score(chord) > score(best)) best = chord
    chords.push(best)
    previous = best
  }

  return chords
}

/** The melody note sounding at a loop position, if any — held notes included. */
export function soundingAt(pattern: Pattern, position: number): PatternNote | undefined {
  return pattern.notes.find((note) => position >= note.step && position < note.step + note.steps)
}

/** The melody note that begins exactly at a loop position, if any. */
export function onsetAt(pattern: Pattern, position: number): PatternNote | undefined {
  return pattern.notes.find((note) => note.step === position)
}
