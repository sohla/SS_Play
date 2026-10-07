import type { LoadedSample, ScheduledEvent } from '@ss/engine'
import { OCTAVES, SCALE, type Piano } from './mapping.ts'

/**
 * `(octave + 1) * 12 + noteIndex`, from the filename's trailing note name.
 *
 * The library is `I-95 Chronicle Piano_C0.aif` through `_C5`, so in practice
 * this reads six Cs — but it is parsed rather than assumed, because the lookup
 * below is only correct if the MIDI numbers are real.
 */
const NOTE_NAMES = 'C C# D D# E F F# G G# A A# B'.split(' ')

export function midiFromName(stem: string): number | null {
  const match = /([A-G](?:#|b)?)(\d)(?!.*\d)/.exec(stem)
  if (!match) return null

  const flats: Record<string, string> = {
    Cb: 'B',
    Db: 'C#',
    Eb: 'D#',
    Fb: 'E',
    Gb: 'F#',
    Ab: 'G#',
    Bb: 'A#',
  }
  const note = flats[match[1] as string] ?? (match[1] as string)
  const index = NOTE_NAMES.indexOf(note)
  if (index === -1) return null

  return (Number(match[2]) + 1) * 12 + index
}

export interface PianoSample {
  bufnum: number
  midi: number
  name: string
}

export function arrangePiano(samples: readonly LoadedSample[]): PianoSample[] {
  return samples
    .map((sample) => {
      const midi = midiFromName(sample.name.replace(/\.[^.]+$/, ''))
      return midi === null ? null : { bufnum: sample.bufnum, midi, name: sample.name }
    })
    .filter((one): one is PianoSample => one !== null)
    .sort((a, b) => a.midi - b.midi)
}

export interface Pick {
  bufnum: number
  /** Semitones the sample had to be stretched to reach the note. */
  shift: number
  index: number
  name: string
}

/**
 * Nearest sample, and how far it had to move.
 *
 * The library is one sample per octave, so almost nothing is played by the
 * sample that was recorded for it. The p-file picks this deliberately — it calls
 * itself a test bench for exactly this — and the shift is worth reporting rather
 * than hiding, because it is the interesting number.
 */
export function nearest(library: readonly PianoSample[], targetMidi: number): Pick | null {
  if (library.length === 0) return null

  let bestIndex = 0
  let bestDistance = Infinity
  for (let index = 0; index < library.length; index++) {
    const distance = Math.abs((library[index] as PianoSample).midi - targetMidi)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }

  const chosen = library[bestIndex] as PianoSample
  return {
    bufnum: chosen.bufnum,
    shift: targetMidi - chosen.midi,
    index: bestIndex,
    name: chosen.name,
  }
}

export const midiratio = (semitones: number) => 2 ** (semitones / 12)

export interface PianoState {
  /** The note that last sounded, for the readout. */
  last: Pick & { midi: number }
}

/**
 * piano1's Pbind, as a generator.
 *
 *   \note,   Pseq([0, 4, 7, 11], inf)
 *   \octave, Pseq([3, 4, 5, 6].stutter(4), inf)
 *
 * so the arpeggio climbs four octaves and starts again — sixteen notes before it
 * repeats, MIDI 36 to 83.
 *
 * Which is worth stating against the p-file's own description of "up to six
 * semitones either way": the top octave reaches 83 and the highest sample is C5
 * at 72, so those four notes are stretched **seven to eleven semitones**. The
 * description is describing the library's spacing, not what this pattern asks of
 * it. Ported as written, because the stretch is audible and is the point.
 */
export function pianoPattern(
  library: readonly PianoSample[],
  read: () => Piano,
  state: PianoState,
): () => ScheduledEvent | null {
  let at = 0

  return () => {
    const note = SCALE[at % SCALE.length] as number
    const octave = OCTAVES[Math.floor(at / SCALE.length) % OCTAVES.length] as number
    at = (at + 1) % (SCALE.length * OCTAVES.length)

    const target = note + 12 * octave
    const pick = nearest(library, target)
    if (!pick) return null

    const now = read()
    state.last = { ...pick, midi: target }

    return {
      def: 'ssp_piano',
      dur: now.dur,
      controls: {
        bufnum: pick.bufnum,
        rate: midiratio(pick.shift),
        amp: now.amp,
        pan: 0,
        // The Pbind sets legato 1.6 and no sustain, so sclang's event system
        // computes dur * legato and sends it to this def's `sustain` — which is
        // an envelope segment *length*, not a level. Sent explicitly here so the
        // note holds as long as it did in the original.
        sustain: now.dur * 1.6,
        release: 2.1,
      },
    }
  }
}
