import { describe, expect, it } from 'vitest'
import { LOOP_S, Loop, MAX_NOTES, UNPITCHED, WRAP, ampOf, dissolve, frameToMs, midiOf, type Note } from '../src/memory.ts'

const half = () => 0.5

/** As the page hears: the scheduler is always a lookahead past the moment an onset arrives. */
function hear(loop: Loop, ms: number, peak = 1, midi = 60) {
  loop.due(ms + 120, 0, half)
  loop.hear(ms, peak, midi)
}

const note = (over: Partial<Note> = {}): Note => ({ at: 1, peak: 0.5, midi: 60, life: 1, played: true, ...over })

describe('midiOf', () => {
  it('rounds a pitch to its semitone, and plays an unpitched onset as middle C', () => {
    expect(midiOf(440, 1)).toBe(69)
    expect(midiOf(452, 1)).toBe(69)
    expect(midiOf(440, 0)).toBe(UNPITCHED)
    expect(midiOf(0, 1)).toBe(UNPITCHED)
  })
})

describe('ampOf', () => {
  it('scales with peak in dB, floored at -50dB, and with life', () => {
    expect(ampOf(note({ peak: 1 }))).toBe(1)
    expect(ampOf(note({ peak: 1, life: 0.5 }))).toBe(0.5)
    expect(ampOf(note({ peak: 10 ** (-25 / 20) }))).toBeCloseTo(0.5)
    expect(ampOf(note({ peak: 0.001 }))).toBe(0)
    expect(ampOf(note({ peak: 0 }))).toBe(0)
  })
})

describe('frameToMs', () => {
  it('turns a sample counter into wall time, across laps of the wrap', () => {
    expect(frameToMs(48000, 1100, 0, 48000)).toBe(1000)
    // Three laps in, with no message in between to count them by.
    const ms = ((3 * WRAP + 48000) / 48000) * 1000
    expect(frameToMs(48000, ms + 40, 0, 48000)).toBeCloseTo(ms)
  })
})

describe('dissolve', () => {
  it('takes life from played notes only, unevenly, and drops the dead', () => {
    const notes = [note({ life: 1 }), note({ life: 0.05 }), note({ played: false })]
    const random = [0, 1, 0.5]
    const out = dissolve(notes, 0.2, () => random.shift()!)
    expect(out.map((one) => one.life)).toEqual([0.9, 1])
  })

  it('takes nothing at rate 0', () => {
    expect(dissolve([note()], 0, half)[0]!.life).toBe(1)
  })
})

describe('Loop', () => {
  it('plays a heard note at its place on every later pass, fading each time', () => {
    const loop = new Loop(0)
    hear(loop, 2500, 1, 64)
    expect(loop.notes[0]!.at).toBe(2.5)

    // Already past in pass 0, so first heard back in pass 1, at full life.
    const due = loop.due(3 * LOOP_S * 1000, 0.25, half)
    expect(due.map((one) => one.ms)).toEqual([12500, 22500])
    expect(due.map((one) => one.note.life)).toEqual([1, 0.75])
  })

  it('places onsets by where they fall in the loop', () => {
    const loop = new Loop(1000)
    loop.hear(1000 + 3 * LOOP_S * 1000 + 400, 1, 60)
    expect(loop.notes[0]!.at).toBeCloseTo(0.4)
  })

  it('lets a note go once its life is spent', () => {
    const loop = new Loop(0)
    hear(loop, 100)
    loop.due(5 * LOOP_S * 1000, 0.5, half)
    expect(loop.notes).toEqual([])
  })

  it('keeps a note at rate 0', () => {
    const loop = new Loop(0)
    hear(loop, 100)
    expect(loop.due(5 * LOOP_S * 1000, 0, half)).toHaveLength(4)
  })

  it('makes room by dropping the faintest', () => {
    const loop = new Loop(0)
    for (let n = 0; n < MAX_NOTES; n++) loop.hear(n, 0.5, 60)
    loop.hear(MAX_NOTES, 0.01, 60)
    loop.hear(MAX_NOTES + 1, 0.9, 60)
    expect(loop.notes).toHaveLength(MAX_NOTES)
    expect(loop.notes.some((one) => one.peak === 0.01)).toBe(false)
    expect(loop.notes.some((one) => one.peak === 0.9)).toBe(true)
  })

  it('skips what it missed while stalled instead of playing it all at once', () => {
    const loop = new Loop(0)
    hear(loop, 100)
    loop.catchUp(LOOP_S * 1000 * 5 + 50)
    const due = loop.due(LOOP_S * 1000 * 5 + 200, 0, half)
    expect(due.map((one) => one.ms)).toEqual([50100])
  })
})
