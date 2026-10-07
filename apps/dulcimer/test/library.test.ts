import { describe, expect, it } from 'vitest'
import { OCTAVES, POOL, DIVS, dulcimerFrom } from '../src/mapping.ts'
import {
  arrangeDulcimer,
  dulcimerPattern,
  midiratio,
  nearest,
  reachableTargets,
  type DulcimerSample,
  type DulcimerState,
} from '../src/pattern.ts'
import type { Motion } from '@ss/motion'

/**
 * The claim this file exists to defend: shipping nine samples instead of
 * twenty-six changes nothing you can hear.
 *
 * The folder holds twenty-six files at thirteen distinct pitches — two
 * round-robin takes each — and `minItem` returns the first match, so one take
 * per pitch is already all that ever sounds. Of those thirteen, only nine are
 * ever nearest to a note this pattern can produce.
 *
 * That is an argument, and an argument about a lookup can be checked rather than
 * trusted. The full pitch list below is read off the library on disk.
 */

/** Every distinct MIDI note in `Celtic Hammered Dulcimer`, filter `Dlcmr-hrd`. */
const FULL_LIBRARY = [26, 30, 33, 36, 38, 42, 45, 48, 50, 54, 57, 60, 64]

/** The nine actually shipped, from the filenames in the store. */
const SHIPPED = [26, 30, 36, 38, 42, 48, 50, 54, 60]

const asLibrary = (midis: readonly number[]): DulcimerSample[] =>
  midis.map((midi, index) => ({ midi, bufnum: index }))

describe('the reachable notes', () => {
  it('is the pool crossed with the three octaves', () => {
    // pool has six notes and the octave sequence visits 4, 3 and 2, so eighteen
    // combinations collapsing to sixteen distinct notes — 31 and 43 each arise
    // two ways.
    expect(reachableTargets()).toEqual([
      19, 24, 26, 28, 31, 35, 36, 38, 40, 43, 47, 48, 50, 52, 55, 59,
    ])
  })

  it('never asks for a note outside what the octave sequence can reach', () => {
    const targets = new Set(reachableTargets())
    for (const note of POOL) {
      for (const octave of OCTAVES) {
        expect(targets.has(note + 12 * octave)).toBe(true)
      }
    }
  })

  it('uses more of the pool as the bar gets finer, which is the gesture', () => {
    // `pool.keep(n)`: a coarser bar plays fewer *different* notes rather than the
    // same ones more slowly.
    expect(DIVS.map((div) => POOL.slice(0, div).length)).toEqual([2, 4, 6])
    expect(POOL.slice(0, 2)).toEqual([0, 11])
    expect(POOL.slice(0, 6)).toEqual([...POOL])
  })
})

describe('nine samples against twenty-six', () => {
  const full = asLibrary(FULL_LIBRARY)
  const shipped = asLibrary(SHIPPED)

  it('picks the same pitch for every note the pattern can play', () => {
    for (const target of reachableTargets()) {
      const fromFull = nearest(full, target)
      const fromShipped = nearest(shipped, target)
      expect(fromShipped?.midi, `target ${target}`).toBe(fromFull?.midi)
    }
  })

  it('applies the same shift, so the rate is identical', () => {
    for (const target of reachableTargets()) {
      expect(nearest(shipped, target)?.shift, `target ${target}`).toBe(
        nearest(full, target)?.shift,
      )
    }
  })

  it('ships nothing that is never selected', () => {
    const selected = new Set(reachableTargets().map((target) => nearest(shipped, target)?.midi))
    for (const midi of SHIPPED) {
      expect(selected.has(midi), `dulc_${midi} is loaded and unreachable`).toBe(true)
    }
  })

  it('omits only pitches that are never selected', () => {
    const selected = new Set(reachableTargets().map((target) => nearest(full, target)?.midi))
    const omitted = FULL_LIBRARY.filter((midi) => !SHIPPED.includes(midi))

    expect(omitted).toEqual([33, 45, 57, 64])
    for (const midi of omitted) {
      expect(selected.has(midi), `midi ${midi} was dropped but is reachable`).toBe(false)
    }
  })
})

describe('the stretch', () => {
  it('stays inside the range the samples were trimmed for', () => {
    const shipped = asLibrary(SHIPPED)
    const shifts = reachableTargets().map((target) => nearest(shipped, target)?.shift ?? 0)

    // -7 to +2. The upward end is what decides the trim: a rate above 1 consumes
    // the buffer faster than real time, so 2.6s of envelope needs
    // 2.6 * midiratio(2) = 2.92s of audio. The files are cut at 3.0s.
    expect(Math.min(...shifts)).toBe(-7)
    expect(Math.max(...shifts)).toBe(2)
    expect(2.6 * midiratio(Math.max(...shifts))).toBeLessThan(3.0)
  })

  it('reads the MIDI note out of the filename', () => {
    const arranged = arrangeDulcimer([
      { name: 'dulc_60.flac', bufnum: 7, numFrames: 1, numChannels: 2, sampleRate: 44100 },
      { name: 'dulc_26.flac', bufnum: 3, numFrames: 1, numChannels: 2, sampleRate: 44100 },
      { name: 'loop_amen.flac', bufnum: 9, numFrames: 1, numChannels: 2, sampleRate: 44100 },
    ])

    // Sorted by pitch, and anything in the shared store that is not ours is
    // ignored rather than guessed at.
    expect(arranged).toEqual([
      { midi: 26, bufnum: 3 },
      { midi: 60, bufnum: 7 },
    ])
  })
})

describe('the octave sequence', () => {
  const library = asLibrary(SHIPPED)

  const run = (shake: number, events: number) => {
    const state: DulcimerState = { last: { midi: 0, shift: 0, sample: 0 } }
    const read = () => dulcimerFrom({ shake } as Motion)
    const next = dulcimerPattern(library, read, state, 4)
    const seen: number[] = []
    for (let n = 0; n < events; n++) {
      next()
      seen.push(state.last.midi)
    }
    return seen
  }

  it('advances on every event, not every bar', () => {
    // The bug this is here for. `\octave` is an ordinary Pbind key over
    // Pseq([4, 3, 2].stutter(2), inf), and a Pbind advances every stream once
    // per event — so it moves per note. The first port held it for a whole bar,
    // which at six steps turned a figure that descends two octaves *inside* one
    // bar into one that holds an octave per bar and descends across six. Flatter,
    // and not what the file plays.
    const notes = run(1, OCTAVES.length)
    const octaves = notes.map((midi) => Math.floor(midi / 12))

    expect(new Set(octaves).size, `stayed in one octave: ${notes.join(',')}`).toBeGreaterThan(1)
  })

  it('covers the whole six-event cycle however the bar is cut', () => {
    for (const shake of [0, 0.2, 1]) {
      const spread = new Set(run(shake, OCTAVES.length).map((midi) => Math.floor(midi / 12)))
      expect(spread.size, `shake ${shake} stayed in one octave`).toBeGreaterThan(1)
    }
  })
})
