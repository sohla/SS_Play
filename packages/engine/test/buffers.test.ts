import { describe, expect, it } from 'vitest'
import { BufAllocator } from '../src/buffers'

describe('allocation', () => {
  it('starts at 0 and counts up', () => {
    const buffers = new BufAllocator(8)
    expect([buffers.alloc(), buffers.alloc(), buffers.alloc()]).toEqual([0, 1, 2])
  })

  it('reuses the lowest freed number', () => {
    const buffers = new BufAllocator(8)
    buffers.alloc()
    buffers.alloc()
    buffers.alloc()
    buffers.free(1)
    expect(buffers.alloc()).toBe(1)
  })

  it('tracks counts', () => {
    const buffers = new BufAllocator(4)
    buffers.alloc()
    buffers.alloc()
    expect(buffers.usedCount).toBe(2)
    expect(buffers.freeCount).toBe(2)
    expect(buffers.used()).toEqual([0, 1])
  })

  it('throws when exhausted rather than returning a colliding number', () => {
    const buffers = new BufAllocator(2)
    buffers.alloc()
    buffers.alloc()
    // Handing out a number already in use would silently overwrite a loaded
    // sample, which is far worse than failing here.
    expect(() => buffers.alloc()).toThrow(/all 2 are in use/)
  })
})

describe('contiguous runs', () => {
  it('claims adjacent numbers for a multichannel load', () => {
    const buffers = new BufAllocator(16)
    expect(buffers.allocContiguous(4)).toEqual([0, 1, 2, 3])
    expect(buffers.alloc()).toBe(4)
  })

  it('skips past a blocked span', () => {
    const buffers = new BufAllocator(16)
    buffers.reserve(2)
    expect(buffers.allocContiguous(4)).toEqual([3, 4, 5, 6])
  })

  it('reports fragmentation rather than silently splitting the run', () => {
    const buffers = new BufAllocator(8)
    buffers.reserve(2)
    buffers.reserve(5)
    expect(() => buffers.allocContiguous(4)).toThrow(/consecutive/)
  })

  it('finds a run that only just fits at the end', () => {
    const buffers = new BufAllocator(8)
    for (const n of [0, 1, 2, 3]) buffers.reserve(n)
    expect(buffers.allocContiguous(4)).toEqual([4, 5, 6, 7])
  })

  it('rejects a nonsensical count', () => {
    const buffers = new BufAllocator(8)
    expect(() => buffers.allocContiguous(0)).toThrow(RangeError)
    expect(() => buffers.allocContiguous(1.5)).toThrow(RangeError)
  })
})

describe('reserving a specific number', () => {
  it('claims it for a page that hardcodes one', () => {
    const buffers = new BufAllocator(8)
    expect(buffers.reserve(5)).toBe(5)
    expect(buffers.isUsed(5)).toBe(true)
  })

  it('refuses to double-book', () => {
    const buffers = new BufAllocator(8)
    buffers.reserve(5)
    expect(() => buffers.reserve(5)).toThrow(/already allocated/)
  })

  it('keeps alloc away from a reserved number', () => {
    const buffers = new BufAllocator(8)
    buffers.reserve(0)
    expect(buffers.alloc()).toBe(1)
  })
})

describe('freeing', () => {
  it('rejects a double free, because it means two owners disagree', () => {
    const buffers = new BufAllocator(8)
    const bufnum = buffers.alloc()
    buffers.free(bufnum)
    expect(() => buffers.free(bufnum)).toThrow(/not allocated/)
  })

  it('rejects an out-of-range number', () => {
    const buffers = new BufAllocator(8)
    expect(() => buffers.free(8)).toThrow(/outside 0\.\.7/)
    expect(() => buffers.free(-1)).toThrow(RangeError)
  })

  it('freeAll resets without complaining', () => {
    const buffers = new BufAllocator(8)
    buffers.alloc()
    buffers.alloc()
    buffers.freeAll()
    expect(buffers.usedCount).toBe(0)
    expect(buffers.alloc()).toBe(0)
  })
})

describe('capacity', () => {
  it('defaults to the engine default of 1024', () => {
    expect(new BufAllocator().capacity).toBe(1024)
  })

  it('rejects a nonsensical capacity', () => {
    expect(() => new BufAllocator(0)).toThrow(RangeError)
    expect(() => new BufAllocator(-1)).toThrow(RangeError)
  })

  it('allows the whole range to be used', () => {
    const buffers = new BufAllocator(3)
    expect([buffers.alloc(), buffers.alloc(), buffers.alloc()]).toEqual([0, 1, 2])
    expect(buffers.freeCount).toBe(0)
  })
})
