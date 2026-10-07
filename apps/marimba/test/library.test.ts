import { describe, expect, it } from 'vitest'
import { DIVS, OCTAVES, POOL, SILENCE_BELOW, marimbaFrom } from '../src/mapping.ts'
import {
  arrangeMarimba,
  marimbaPattern,
  nearest,
  reachableTargets,
  type MarimbaSample,
  type MarimbaState,
} from '../src/pattern.ts'
import type { Motion } from '@ss/motion'

/** Every pitch in `African Marimba`, filter `Marimba ln mf l1x`. Read off disk. */
const FULL_LIBRARY = [41, 45, 47, 50, 53, 57, 59, 62, 65, 69, 71, 74, 77, 83, 86, 89, 93, 95]

/** The ten shipped. */
const SHIPPED = [47, 53, 59, 62, 65, 71, 74, 77, 83, 86]

const asLibrary = (midis: readonly number[]): MarimbaSample[] =>
  midis.map((midi, index) => ({ midi, bufnum: index }))

describe('ten samples against eighteen', () => {
  const full = asLibrary(FULL_LIBRARY)
  const shipped = asLibrary(SHIPPED)

  it('reaches thirteen notes across three octaves', () => {
    expect(reachableTargets()).toEqual([48, 52, 55, 60, 62, 64, 67, 72, 74, 76, 79, 84, 86])
  })

  it('picks the same sample and shift for every note the pattern can play', () => {
    for (const target of reachableTargets()) {
      expect(nearest(shipped, target)?.midi, `target ${target}`).toBe(nearest(full, target)?.midi)
      expect(nearest(shipped, target)?.shift, `target ${target}`).toBe(
        nearest(full, target)?.shift,
      )
    }
  })

  it('omits only pitches the full library never selects either', () => {
    const selected = new Set(reachableTargets().map((target) => nearest(full, target)?.midi))
    const omitted = FULL_LIBRARY.filter((midi) => !SHIPPED.includes(midi))

    expect(omitted).toEqual([41, 45, 50, 57, 69, 89, 93, 95])
    for (const midi of omitted) {
      expect(selected.has(midi), `midi ${midi} dropped but reachable`).toBe(false)
    }
  })

  it('ships nothing unreachable', () => {
    const selected = new Set(reachableTargets().map((target) => nearest(shipped, target)?.midi))
    for (const midi of SHIPPED) expect(selected.has(midi), `mar_${midi} unreachable`).toBe(true)
  })

  it('never stretches a bar more than two semitones', () => {
    // Four pitches per octave in the library, so a neighbour is always close —
    // which is why the trim at 3.0s is enough: the fastest rate asked for is
    // midiratio(2), and 2.6s of envelope then needs 2.92s of audio.
    const shifts = reachableTargets().map((target) => nearest(shipped, target)?.shift ?? 0)
    expect(Math.min(...shifts)).toBe(-1)
    expect(Math.max(...shifts)).toBe(2)
  })
})

describe('what is bar-scoped and what is not', () => {
  const library = asLibrary(SHIPPED)
  const motion = (shake: number) => ({ shake, yaw: 0.5, roll: 0, pitch: 0 }) as Motion

  const run = (shake: number, events: number) => {
    const state: MarimbaState = { last: { midi: 0, shift: 0, sample: 0, div: 1 } }
    const read = () => marimbaFrom(motion(shake))
    const next = marimbaPattern(library, read, state)
    const out: { midi: number; octave: number }[] = []
    for (let n = 0; n < events; n++) {
      next()
      out.push({ midi: state.last.midi, octave: Math.floor(state.last.midi / 12) })
    }
    return out
  }

  it('advances the octave on every event, not every bar', () => {
    // The bug this test exists for: `\octave` is an ordinary Pbind key over
    // Pseq([3,4,5].stutter(4), inf), so it moves per event. Treating it as
    // bar-scoped gave a flat figure that walks octaves across bars instead of
    // within them — and at eight steps a single bar covers two thirds of the
    // cycle.
    const hard = run(1, 12)
    const octaves = hard.map((event) => event.octave)

    // Twelve events at the finest subdivision must have visited more than one
    // octave, because the sequence is twelve long and spans three.
    expect(new Set(octaves).size).toBeGreaterThan(1)
  })

  it('walks the whole octave cycle in twelve events whatever the subdivision', () => {
    // Twelve events is one full pass of OCTAVES regardless of how those events
    // are grouped into bars, which is what "event-scoped" means.
    for (const shake of [0, 0.35, 0.7, 1]) {
      const notes = run(shake, OCTAVES.length)
      const spread = new Set(notes.map((event) => Math.floor(event.midi / 12)))
      expect(spread.size, `shake ${shake} stayed in one octave`).toBeGreaterThan(1)
    }
  })

  it('holds the subdivision for the rest of the bar when the hand changes mid-bar', () => {
    // The other half: div, step and note are bar-scoped, because Pswitch embeds
    // a whole sub-pattern before re-reading the index. A subdivision that
    // changed mid-bar would leave the downbeat somewhere other than the start.
    const state: MarimbaState = { last: { midi: 0, shift: 0, sample: 0, div: 1 } }
    let shake = 1
    const next = marimbaPattern(library, () => marimbaFrom(motion(shake)), state)

    // First event of a bar at the finest subdivision.
    next()
    expect(state.last.div, 'did not start at eight steps').toBe(8)

    // Put it down mid-bar. The remaining seven steps must still be the bar that
    // was already committed to.
    shake = 0
    const during: number[] = []
    for (let n = 1; n < 8; n++) {
      next()
      during.push(state.last.div)
    }
    expect(during, 'the subdivision changed inside the bar').toEqual([8, 8, 8, 8, 8, 8, 8])

    // And the next bar picks up the new reading.
    next()
    expect(state.last.div, 'the next bar did not re-read the index').toBe(1)
  })
})

describe('reading the library off filenames', () => {
  it('takes the MIDI note from the name and ignores anything else in the store', () => {
    expect(
      arrangeMarimba([
        { name: 'mar_86.flac', bufnum: 4, numFrames: 1, numChannels: 2, sampleRate: 44100 },
        { name: 'mar_47.flac', bufnum: 1, numFrames: 1, numChannels: 2, sampleRate: 44100 },
        { name: 'dulc_26.flac', bufnum: 9, numFrames: 1, numChannels: 2, sampleRate: 44100 },
      ]),
    ).toEqual([
      { midi: 47, bufnum: 1 },
      { midi: 86, bufnum: 4 },
    ])
  })

  it('uses more of the pool as the bar gets finer', () => {
    expect(DIVS.map((div) => POOL.slice(0, div).length)).toEqual([1, 2, 4, 8])
    expect(POOL.slice(0, 1)).toEqual([12])
    expect(POOL.slice(0, 8)).toEqual([...POOL])
  })
})

describe('the silence threshold', () => {
  const at = (shake: number) => marimbaFrom({ shake, yaw: 0.5, roll: 0, pitch: 0 } as Motion)

  it('counts a still phone as stopped', () => {
    // The dead zone sets -90dB, which is 3.2e-5 — not zero. A threshold under
    // that leaves the page reporting itself as sounding while nothing is
    // happening, which is how this was found.
    expect(at(0).energy).toBeLessThan(SILENCE_BELOW)
  })

  it('leaves no gesture in the ambiguous band', () => {
    // The real invariant, and a better one than "the quietest note is loud
    // enough": every level the mapping can produce is either the dead zone or a
    // real note, and never between the two. If any shake landed in the band the
    // page would be neither honestly stopped nor usefully sounding.
    //
    // A first attempt here asserted that shake 0.001 was a real note. It is not
    // — the dead zone extends some way up the curve, because -41dB is its lower
    // bound and anything under -40 is dropped to -90. Worth knowing: the dead
    // zone is a region, not a single point at zero.
    const deadZone = 10 ** (-90 * 0.05)

    for (let n = 0; n <= 200; n++) {
      const level = at(n / 200).energy
      const ok = level <= deadZone || level > SILENCE_BELOW
      expect(ok, `shake ${(n / 200).toFixed(3)} gave ${level}, inside the band`).toBe(true)
    }
  })

  it('reaches a real note well above the threshold once it is moved', () => {
    // -10dB at the top, which is 0.316 — three and a half orders of magnitude up.
    expect(at(1).energy).toBeGreaterThan(SILENCE_BELOW * 100)
  })
})
