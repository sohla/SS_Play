import type { LoadedSample, ScheduledEvent } from '@ss/engine'
import { BEAT_S, DIVS, OCTAVES, POOL, type Dulcimer } from './mapping.ts'

export interface DulcimerSample {
  bufnum: number
  midi: number
}

/**
 * The library, keyed by the MIDI note each sample was recorded at.
 *
 * Nine samples, where the original scans twenty-six. That is not a reduction in
 * what you hear — it is the seventeen the lookup can never select.
 *
 * The folder holds thirteen distinct pitches with two round-robin takes each,
 * and `minItem` returns the first match, so one take of each pitch is already
 * all that ever sounds. Of those thirteen, the sixteen notes this pattern can
 * produce are nearest to only nine. The rest are loaded, held for the life of
 * the page, and unreachable.
 *
 * The filename carries the MIDI number because that is the only thing the lookup
 * needs, and because the original's names contain a `#`, which is a fragment
 * delimiter in a URL.
 */
export function arrangeDulcimer(samples: readonly LoadedSample[]): DulcimerSample[] {
  return samples
    .map((sample) => {
      const match = /dulc_(\d+)/.exec(sample.name)
      return match ? { bufnum: sample.bufnum, midi: Number(match[1]) } : null
    })
    .filter((one): one is DulcimerSample => one !== null)
    .sort((a, b) => a.midi - b.midi)
}

export interface Pick {
  bufnum: number
  shift: number
  midi: number
}

/** `samplesLib.minItem { |s| (s.midiNote - target).abs }`, and the rate to reach it. */
export function nearest(library: readonly DulcimerSample[], target: number): Pick | null {
  if (library.length === 0) return null

  let best = library[0] as DulcimerSample
  for (const candidate of library) {
    if (Math.abs(candidate.midi - target) < Math.abs(best.midi - target)) best = candidate
  }

  return { bufnum: best.bufnum, shift: target - best.midi, midi: best.midi }
}

export const midiratio = (semitones: number) => 2 ** (semitones / 12)

/** Every note the pattern can ask for, which is what makes the nine provable. */
export function reachableTargets(): number[] {
  const targets = new Set<number>()
  for (const note of POOL) for (const octave of [4, 3, 2]) targets.add(note + 12 * octave)
  return [...targets].sort((a, b) => a - b)
}

export interface DulcimerState {
  last: { midi: number; shift: number; sample: number }
}

/**
 * dulcimer1's Pbind, as a generator.
 *
 *   \div,  Pswitch(divs.collect { Pn(n, n) },            Pkey(\divIdx))
 *   \step, Pswitch(divs.collect { Pseries(0, 1, n) },    Pkey(\divIdx))
 *   \note, Pswitch(divs.collect { Pseq(pool.keep(n), 1) }, Pkey(\divIdx))
 *
 * Three switches on one live index, which is the reason this cannot be a Demand
 * graph: they have to agree about which bar they are in, and the index moves
 * while the pattern runs.
 *
 * `pool.keep(n)` is the quiet idea — a coarser bar plays fewer *different* notes,
 * not the same notes more slowly. At two steps it is just the root and the
 * seventh; at six it reaches down to the fourth below.
 *
 * The octave sequence is independent of the subdivision and two bars long, so the
 * figure walks down three octaves over six bars regardless of how finely those
 * bars are cut.
 */
export function dulcimerPattern(
  library: readonly DulcimerSample[],
  read: () => Dulcimer,
  state: DulcimerState,
  /** The private bus the fx tail reads. Voices never reach the hardware. */
  outBus: number,
): () => ScheduledEvent | null {
  let step = 0
  let div = DIVS[0] as number
  let notes: readonly number[] = POOL.slice(0, DIVS[0])
  let amp = 0
  let octaveAt = 0

  return () => {
    if (step === 0) {
      // Read once per bar: Pswitch embeds a whole sub-pattern before consulting
      // the index again, so a change lands on the beat.
      const now = read()
      div = DIVS[now.divIdx] ?? (DIVS[0] as number)
      notes = POOL.slice(0, div)
      amp = now.amp
    }

    const note = notes[step % notes.length] ?? 0
    const octave = OCTAVES[octaveAt % OCTAVES.length] as number
    const target = note + 12 * octave

    const pick = nearest(library, target)
    if (!pick) return null

    const dur = BEAT_S / div
    state.last = { midi: target, shift: pick.shift, sample: pick.midi }

    step += 1
    if (step >= div) {
      step = 0
      // The octave advances per bar, not per note.
      octaveAt = (octaveAt + 1) % OCTAVES.length
    }

    return {
      def: 'ssp_dulcimer',
      dur,
      controls: {
        out: outBus,
        bufnum: pick.bufnum,
        rate: midiratio(pick.shift),
        // The LFTri edge is tuned from the sounding note, not the sample's.
        freq: 440 * 2 ** ((target - 69) / 12),
        amp,
        // `\legato, 0.8` into an envelope whose middle segment is named sustain.
        sustain: dur * 0.8,
        attack: 0.4,
        release: 2,
        pan: Math.random() * 0.6 - 0.3,
      },
    }
  }
}
