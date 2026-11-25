import { describe, expect, it } from 'vitest'
import { DEAF_MS, LOOP_S, LOWEST, Loop, MAX_NOTES, SPAN, WRAP, ampOf, dissolve, frameToMs, midiOf, type Note } from '../src/memory.ts'

const half = () => 0.5

/** As the page hears: the scheduler is always a lookahead past the moment an onset arrives. */
function hear(loop: Loop, ms: number, peak = 1, midi = 60) {
  loop.due(ms + 120, { dying: 0, loops: 1 }, half)
  loop.hear(ms, peak, midi)
}

const note = (over: Partial<Note> = {}): Note => ({ at: 1, peak: 0.5, midi: 60, played: true, ...over })

describe('midiOf', () => {
  it('plays louder onsets higher, from the lowest note at -50dB to the top at 0dB', () => {
    expect(midiOf(1)).toBe(LOWEST + SPAN)
    expect(midiOf(10 ** (-25 / 20))).toBe(LOWEST + SPAN / 2)
    expect(midiOf(0.001)).toBe(LOWEST)
    expect(midiOf(0)).toBe(LOWEST)
  })
})

describe('ampOf', () => {
  it('scales with peak in dB, floored at -50dB', () => {
    expect(ampOf(note({ peak: 1 }))).toBe(1)
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
  it('kills that many of the played notes, picked at random, and spares the unplayed', () => {
    const notes = [note({ at: 1 }), note({ at: 2 }), note({ at: 3 }), note({ at: 4, played: false })]
    const random = [0, 0.99]
    const out = dissolve(notes, { dying: 2, loops: 1 }, () => random.shift()!)
    expect(out.map((one) => one.at)).toEqual([2, 4])
  })

  it('fades a dying note over its loops, and only then lets it go', () => {
    let notes = dissolve([note()], { dying: 1, loops: 4 }, half)
    expect(notes[0]!.life).toBeCloseTo(0.75)
    expect(ampOf(notes[0]!)).toBeCloseTo(0.75 * ampOf(note()))
    // Already dying, so not picked again: it keeps fading at its own pace.
    notes = dissolve(notes, { dying: 1, loops: 4 }, half)
    notes = dissolve(notes, { dying: 1, loops: 4 }, half)
    expect(notes[0]!.life).toBeCloseTo(0.25)
    expect(dissolve(notes, { dying: 0, loops: 4 }, half)).toEqual([])
  })

  it('picks new notes to die from the healthy ones only', () => {
    const notes = [note({ at: 1, life: 0.5 }), note({ at: 2 })]
    const out = dissolve(notes, { dying: 1, loops: 2 }, () => 0)
    expect(out.map((one) => one.at)).toEqual([2])
    expect(out[0]!.life).toBeCloseTo(0.5)
  })

  it('kills none at 0, and no more than have played', () => {
    expect(dissolve([note()], { dying: 0, loops: 1 }, half)).toHaveLength(1)
    expect(dissolve([note(), note({ played: false })], { dying: 5, loops: 1 }, half)).toHaveLength(1)
  })
})

describe('Loop', () => {
  it('plays a heard note at its place on every later pass', () => {
    const loop = new Loop(0)
    hear(loop, 2500, 1, 64)
    expect(loop.notes[0]!.at).toBe(2.5)

    // Already past in pass 0, so first heard back in pass 1.
    const due = loop.due(3 * LOOP_S * 1000, { dying: 0, loops: 1 }, half)
    expect(due.map((one) => one.ms)).toEqual([LOOP_S * 1000 + 2500, 2 * LOOP_S * 1000 + 2500])
  })

  it('places onsets by where they fall in the loop', () => {
    const loop = new Loop(1000)
    loop.hear(1000 + 3 * LOOP_S * 1000 + 400, 1, 60)
    expect(loop.notes[0]!.at).toBeCloseTo(0.4)
  })

  it('kills notes as each pass ends, only once they have played', () => {
    const loop = new Loop(0)
    hear(loop, 100)
    hear(loop, 200)
    // Pass 0 ends with neither yet played back; pass 1 plays both, and its end kills one.
    expect(loop.due(LOOP_S * 1000, { dying: 1, loops: 1 }, half)).toHaveLength(0)
    expect(loop.notes).toHaveLength(2)
    expect(loop.due(2 * LOOP_S * 1000, { dying: 1, loops: 1 }, half)).toHaveLength(2)
    expect(loop.notes).toHaveLength(1)
  })

  it('keeps every note when none die', () => {
    const loop = new Loop(0)
    hear(loop, 100)
    expect(loop.due(5 * LOOP_S * 1000, { dying: 0, loops: 1 }, half)).toHaveLength(4)
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

  it('does not hear its own notes coming back, but hears what follows them', () => {
    const loop = new Loop(0)
    hear(loop, 1000)
    const back = LOOP_S * 1000 + 1000
    const [played] = loop.due(back + 100, { dying: 0, loops: 1 }, half)
    expect(played!.ms).toBe(back)
    expect(loop.hear(back + 80, 1, 60)).toBe(false)
    expect(loop.hear(back + DEAF_MS + 1, 1, 60)).toBe(true)
    expect(loop.notes).toHaveLength(2)
  })

  it('does not count a note that has been sent but not yet sounded', () => {
    const loop = new Loop(0)
    hear(loop, 1000)
    loop.due(LOOP_S * 1000 + 1100, { dying: 0, loops: 1 }, half)
    expect(loop.hear(LOOP_S * 1000 + 950, 1, 60)).toBe(true)
  })

  it('skips what it missed while stalled instead of playing it all at once', () => {
    const loop = new Loop(0)
    hear(loop, 100)
    loop.catchUp(LOOP_S * 1000 * 5 + 50)
    const due = loop.due(LOOP_S * 1000 * 5 + 200, { dying: 0, loops: 1 }, half)
    expect(due.map((one) => one.ms)).toEqual([LOOP_S * 1000 * 5 + 100])
  })
})
