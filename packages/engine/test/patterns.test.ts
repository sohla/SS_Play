import { describe, expect, it } from 'vitest'
import { bind, hold, iwhite, pn, rand, seq, series, switchOn, white } from '../src/patterns.ts'

const take = <T>(pattern: () => { next(): T | undefined }, n: number) => {
  const stream = pattern()
  return Array.from({ length: n }, () => stream.next())
}

describe('the pattern primitives', () => {
  it('seq runs its values once by default and then ends', () => {
    expect(take(seq([1, 2, 3]), 5)).toEqual([1, 2, 3, undefined, undefined])
  })

  it('seq repeats the whole list, not each element', () => {
    expect(take(seq([1, 2], 3), 7)).toEqual([1, 2, 1, 2, 1, 2, undefined])
  })

  it('pn repeats one value and then ends', () => {
    expect(take(pn(4, 4), 6)).toEqual([4, 4, 4, 4, undefined, undefined])
  })

  it('series counts', () => {
    expect(take(series(0, 1, 4), 5)).toEqual([0, 1, 2, 3, undefined])
  })

  it('white stays inside its bounds', () => {
    for (const value of take(white(2, 5), 200)) {
      expect(value).toBeGreaterThanOrEqual(2)
      expect(value).toBeLessThanOrEqual(5)
    }
  })

  it('iwhite is inclusive at both ends, as sclang is for integers', () => {
    const seen = new Set(take(iwhite(1, 3), 400))
    expect([...seen].sort()).toEqual([1, 2, 3])
  })

  it('hold never ends', () => {
    expect(take(hold('x'), 3)).toEqual(['x', 'x', 'x'])
  })
})

describe('switchOn, which is why this exists at all', () => {
  const branches = [pn(1, 1), pn(2, 2), pn(4, 4)]

  it('embeds the whole selected pattern before reading the index again', () => {
    // The difference between a bar and a note. If it re-read per value, a
    // subdivision would change halfway through one.
    let index = 2
    const values = take(switchOn(branches, () => index), 4)
    expect(values).toEqual([4, 4, 4, 4])
  })

  it('takes a new index only at a boundary', () => {
    let index = 2
    const stream = switchOn(branches, () => index)()

    expect(stream.next()).toBe(4)
    index = 0
    // Still inside the four, so the change waits.
    expect(stream.next()).toBe(4)
    expect(stream.next()).toBe(4)
    expect(stream.next()).toBe(4)
    // Boundary.
    expect(stream.next()).toBe(1)
  })

  it('clamps an index outside the list rather than returning nothing', () => {
    expect(switchOn(branches, () => -5)().next()).toBe(1)
    expect(switchOn(branches, () => 99)().next()).toBe(4)
  })

  it('rounds a fractional index, as the original does', () => {
    expect(switchOn(branches, () => 1.4)().next()).toBe(2)
    expect(switchOn(branches, () => 1.6)().next()).toBe(4)
  })

  it('keeps interlocking switches in step', () => {
    // The whole reason this runs in JavaScript. div, step and note each switch
    // on the same index and must agree about where a bar begins — in a Demand
    // graph they are three streams trusted to stay together.
    let index = 1
    const div = switchOn([pn(1, 1), pn(2, 2), pn(4, 4)], () => index)()
    const step = switchOn([series(0, 1, 1), series(0, 1, 2), series(0, 1, 4)], () => index)()
    const note = switchOn([seq([0]), seq([0, 4]), seq([0, 4, 7, 11])], () => index)()

    const rows: string[] = []
    for (let n = 0; n < 4; n++) rows.push(`${div.next()}:${step.next()}:${note.next()}`)
    expect(rows).toEqual(['2:0:0', '2:1:4', '2:0:0', '2:1:4'])

    index = 2
    const after: string[] = []
    for (let n = 0; n < 4; n++) after.push(`${div.next()}:${step.next()}:${note.next()}`)
    expect(after).toEqual(['4:0:0', '4:1:4', '4:2:7', '4:3:11'])
  })
})

describe('bind', () => {
  it('pulls one value from each stream, as a Pbind does per event', () => {
    const streams = { note: seq([1, 2, 3])(), pan: hold(0)() }
    expect(bind(streams)).toEqual({ note: 1, pan: 0 })
    expect(bind(streams)).toEqual({ note: 2, pan: 0 })
  })
})

describe('rand', () => {
  it('only returns values from its list', () => {
    for (const value of take(rand([3, 7, 11]), 200)) expect([3, 7, 11]).toContain(value)
  })

  it('ends after its repeat count', () => {
    expect(take(rand([1], 2), 3)).toEqual([1, 1, undefined])
  })
})
