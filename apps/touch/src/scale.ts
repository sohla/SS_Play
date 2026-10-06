export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']

/** Semitone offsets from the root. */
export const SCALES = {
  pentatonic: [0, 2, 4, 7, 9],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  blues: [0, 3, 5, 6, 7, 10],
} as const

export type ScaleName = keyof typeof SCALES

/** C3. Low enough for a saw to have body, high enough to stay out of the mud. */
const BASE_MIDI = 48

/**
 * The MIDI note for each strip, left to right, spanning `octaves` plus the
 * octave itself so the surface starts and ends on the root.
 */
export function stripNotes(root: number, scale: ScaleName, octaves = 2): number[] {
  const degrees = SCALES[scale]
  const notes: number[] = []

  for (let octave = 0; octave < octaves; octave++) {
    for (const degree of degrees) {
      notes.push(BASE_MIDI + root + degree + octave * 12)
    }
  }
  notes.push(BASE_MIDI + root + octaves * 12)

  return notes
}

export const midiToFreq = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

export const noteName = (midi: number) =>
  `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`

/**
 * Hue for a strip, spread across 300° rather than the full circle.
 *
 * A full 360° wrap puts the same red at both ends, so the top and bottom of the
 * range look identical — on a pitch surface that is the one thing the colour is
 * there to distinguish.
 */
export const stripHue = (index: number, count: number) => (index / Math.max(1, count - 1)) * 300
