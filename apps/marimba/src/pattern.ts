import type { LoadedSample, ScheduledEvent } from '@ss/engine'
import { BEAT_S, DIVS, OCTAVES, POOL, type Marimba } from './mapping.ts'

export interface MarimbaSample {
  bufnum: number
  midi: number
}

/**
 * The library, keyed by the MIDI note each bar was recorded at.
 *
 * Ten, where the original scans eighteen. The eight omitted are ones the lookup
 * can never select: the pattern can produce thirteen notes, and each is nearest
 * to one of ten samples. Checked in test/library.test.ts rather than asserted.
 *
 * The marimba has only D, F, A and B per octave — four of twelve — so almost
 * every note is reached by shifting a neighbour. The shift never exceeds two
 * semitones, which on a mallet instrument is well within the range where the
 * transient still identifies the instrument and the tail does the stretching.
 */
export function arrangeMarimba(samples: readonly LoadedSample[]): MarimbaSample[] {
  return samples
    .map((sample) => {
      const match = /mar_(\d+)/.exec(sample.name)
      return match ? { bufnum: sample.bufnum, midi: Number(match[1]) } : null
    })
    .filter((one): one is MarimbaSample => one !== null)
    .sort((a, b) => a.midi - b.midi)
}

export interface Pick {
  bufnum: number
  shift: number
  midi: number
}

/** `samplesLib.minItem { |s| (s.midiNote - target).abs }`, and the rate to reach it. */
export function nearest(library: readonly MarimbaSample[], target: number): Pick | null {
  if (library.length === 0) return null

  let best = library[0] as MarimbaSample
  for (const candidate of library) {
    if (Math.abs(candidate.midi - target) < Math.abs(best.midi - target)) best = candidate
  }

  return { bufnum: best.bufnum, shift: target - best.midi, midi: best.midi }
}

export const midiratio = (semitones: number) => 2 ** (semitones / 12)

/** Every note the pattern can ask for, which is what makes the ten provable. */
export function reachableTargets(): number[] {
  const targets = new Set<number>()
  for (const note of POOL) for (const octave of [3, 4, 5]) targets.add(note + 12 * octave)
  return [...targets].sort((a, b) => a - b)
}

export interface MarimbaState {
  last: { midi: number; shift: number; sample: number; div: number }
}

/**
 * multiBeat5's Pbind, as a generator.
 *
 * Three switches on one live index — `\div`, `\step` and `\note` — which is why
 * this cannot be a Demand graph: they must agree about which bar they are in
 * while the index moves underneath them.
 *
 * Bar-scoped and event-scoped keys are mixed here, and getting them the wrong way
 * round changes the figure:
 *
 *   `\div`, `\step`, `\note` are bar-scoped, because `Pswitch` embeds a whole
 *   sub-pattern before re-reading the index.
 *
 *   `\octave` is **event**-scoped. It is an ordinary Pbind key over
 *   `Pseq([3, 4, 5].stutter(4), inf)`, and a Pbind advances every stream once per
 *   event — so at eight steps a bar covers two thirds of the octave cycle, and
 *   at one step a bar is a single note and the cycle takes twelve bars.
 *
 * That interaction is the instrument: the same twelve-event octave walk reads as
 * a slow descent when the bar is coarse and as an arpeggio when it is fine.
 */
export function marimbaPattern(
  library: readonly MarimbaSample[],
  read: () => Marimba,
  state: MarimbaState,
): () => ScheduledEvent | null {
  let step = 0
  let div = DIVS[0] as number
  let notes: readonly number[] = POOL.slice(0, DIVS[0])
  let energy = 0
  let panBias = 0
  let octaveAt = 0

  return () => {
    if (step === 0) {
      // Read once per bar: the three Pswitch keys only reconsider the index at a
      // bar boundary, so a change lands on the beat.
      const now = read()
      div = DIVS[now.divIdx] ?? (DIVS[0] as number)
      notes = POOL.slice(0, div)
      energy = now.energy
      panBias = now.panBias
    }

    const note = notes[step % notes.length] ?? 0
    const octave = OCTAVES[octaveAt % OCTAVES.length] as number
    const target = note + 12 * octave

    const pick = nearest(library, target)
    if (!pick) return null

    const dur = BEAT_S / div
    const downbeat = step === 0

    state.last = { midi: target, shift: pick.shift, sample: pick.midi, div }

    step += 1
    if (step >= div) step = 0
    octaveAt = (octaveAt + 1) % OCTAVES.length

    return {
      def: 'ssp_marimba',
      dur,
      controls: {
        bufnum: pick.bufnum,
        rate: midiratio(pick.shift),
        amp: energy * (downbeat ? 1.0 : 0.6),
        // `\legato, 0.8` into an envelope whose middle segment is named sustain.
        sustain: dur * 0.8,
        attack: 0.004,
        release: dur * 4 + 0.2,
        // `((panBias ? 0) + rrand(-0.2, 0.2)).clip(-1, 1)`
        pan: Math.min(Math.max(panBias + (Math.random() * 0.4 - 0.2), -1), 1),
      },
    }
  }
}
