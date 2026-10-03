import { describe, expect, it } from 'vitest'
import { ctl, f, i } from '../src/ctl'

describe('the integer inference footgun', () => {
  it('sends a whole-number control as a float', () => {
    // send('/n_set', id, 'freq', 440) would encode 440 as int32, because the
    // library types any JS integer that way. Control buses are floats.
    expect(ctl({ freq: 440 })).toEqual(['freq', { type: 'float', value: 440 }])
  })

  it('sends a fractional control as a float too, so the rule has no exceptions', () => {
    expect(ctl({ amp: 0.3 })).toEqual(['amp', { type: 'float', value: 0.3 }])
  })

  it('leaves an explicit integer alone', () => {
    expect(ctl({ bufnum: i(7) })).toEqual(['bufnum', { type: 'int', value: 7 }])
  })

  it('mixes both in declaration order', () => {
    expect(ctl({ freq: 440, bufnum: i(3), amp: 0.5 })).toEqual([
      'freq',
      { type: 'float', value: 440 },
      'bufnum',
      { type: 'int', value: 3 },
      'amp',
      { type: 'float', value: 0.5 },
    ])
  })
})

describe('edge values', () => {
  it.each([
    ['zero', 0],
    ['negative zero', -0],
    ['a negative', -1],
    ['a very large float', 1e21],
    ['a denormal', 5e-324],
  ])('passes %s through as a float', (_label, value) => {
    expect(ctl({ x: value })).toEqual(['x', { type: 'float', value }])
  })

  it('accepts an empty control set', () => {
    expect(ctl({})).toEqual([])
  })
})

describe('values that must not reach scsynth', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s, naming the control', (_label, value) => {
    // These encode to a float scsynth will happily read as garbage, and the
    // resulting silence or blown-up output is hard to trace back.
    expect(() => ctl({ cutoff: value })).toThrow(/cutoff/)
  })
})

describe('the wrappers', () => {
  it('i() refuses a non-integer rather than truncating', () => {
    expect(() => i(1.5)).toThrow(TypeError)
  })

  it('f() refuses a non-finite value', () => {
    expect(() => f(Number.NaN)).toThrow(TypeError)
  })

  it('i() accepts negatives, which node ids and bus indices use', () => {
    expect(i(-1)).toEqual({ type: 'int', value: -1 })
  })
})
