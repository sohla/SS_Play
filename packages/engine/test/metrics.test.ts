import { describe, expect, it, vi } from 'vitest'
import { createMetricsPoller, createMetricsReader, type MetricsSchema } from '../src/metrics'

// Deliberately mirrors the real schema's awkward parts: non-contiguous offsets,
// an enum with labels, and a gap where no metric lives.
const schema: MetricsSchema = {
  metrics: {
    engineProcessCount: { offset: 0, type: 'counter', unit: 'count' },
    engineMessagesDropped: { offset: 2, type: 'counter' },
    bufferPoolUsedBytes: { offset: 49, type: 'gauge', unit: 'bytes' },
    mode: { offset: 61, type: 'enum', values: ['sab', 'postMessage'] },
    audioHealthPct: { offset: 76, type: 'gauge', unit: '%' },
  },
}

const array = (values: Record<number, number>) => {
  const out = new Uint32Array(77)
  for (const [offset, value] of Object.entries(values)) out[Number(offset)] = value
  return out
}

describe('reading', () => {
  const read = createMetricsReader(schema)

  it('maps offsets to names', () => {
    const snapshot = read(array({ 0: 1234, 2: 7, 49: 4096 }))
    expect(snapshot['engineProcessCount']).toBe(1234)
    expect(snapshot['engineMessagesDropped']).toBe(7)
    expect(snapshot['bufferPoolUsedBytes']).toBe(4096)
  })

  it('resolves enum labels rather than reporting the raw index', () => {
    expect(read(array({ 61: 0 }))['mode']).toBe('sab')
    expect(read(array({ 61: 1 }))['mode']).toBe('postMessage')
  })

  it('falls back to the raw value for an out-of-range enum', () => {
    expect(read(array({ 61: 9 }))['mode']).toBe(9)
  })

  it('reads the highest offset, which sits past the metric count', () => {
    // 73 real metrics span offsets 0..76, so deriving a length from the count
    // would silently drop the tail.
    expect(read(array({ 76: 100 }))['audioHealthPct']).toBe(100)
  })

  it('skips a metric the array is too short to hold', () => {
    const snapshot = createMetricsReader(schema)(new Uint32Array(3))
    expect(snapshot).not.toHaveProperty('audioHealthPct')
    expect(snapshot['engineProcessCount']).toBe(0)
  })

  it('tolerates a schema naming something this build does not expose', () => {
    const read = createMetricsReader({
      metrics: { ...schema.metrics, somethingNew: { offset: 900 } },
    })
    expect(() => read(array({}))).not.toThrow()
  })
})

describe('polling', () => {
  function harness() {
    let values = new Uint32Array(77)
    const timers = new Set<() => void>()

    const poller = createMetricsPoller({
      source: { getMetricsArray: () => values },
      schema,
      setInterval: ((fn: () => void) => {
        timers.add(fn)
        return fn as unknown as ReturnType<typeof setInterval>
      }) as unknown as typeof globalThis.setInterval,
      clearInterval: ((handle: unknown) => {
        timers.delete(handle as () => void)
      }) as unknown as typeof globalThis.clearInterval,
    })

    return {
      poller,
      get running() {
        return timers.size > 0
      },
      tick: () => {
        for (const fn of [...timers]) fn()
      },
      set: (next: Record<number, number>) => {
        values = array(next)
      },
    }
  }

  it('does not run until something subscribes', () => {
    const h = harness()
    expect(h.running).toBe(false)
    h.poller.subscribe(() => {})
    expect(h.running).toBe(true)
  })

  it('stops when the last subscriber leaves, so an unmounted panel costs nothing', () => {
    const h = harness()
    const first = h.poller.subscribe(() => {})
    const second = h.poller.subscribe(() => {})

    first()
    expect(h.running).toBe(true)
    second()
    expect(h.running).toBe(false)
  })

  it('shares one timer across subscribers', () => {
    const h = harness()
    const a = vi.fn()
    const b = vi.fn()
    h.poller.subscribe(a)
    h.poller.subscribe(b)

    h.set({ 0: 1 })
    h.tick()

    expect(a).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce()
  })

  it('notifies only when a value actually changed', () => {
    const h = harness()
    const listener = vi.fn()
    h.poller.subscribe(listener)

    h.set({ 0: 5 })
    h.tick()
    expect(listener).toHaveBeenCalledOnce()

    h.tick()
    h.tick()
    expect(listener).toHaveBeenCalledOnce()

    h.set({ 0: 6 })
    h.tick()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('keeps one snapshot object so an external store need not allocate per tick', () => {
    const h = harness()
    h.poller.subscribe(() => {})

    const first = h.poller.snapshot
    h.set({ 0: 1 })
    h.tick()
    h.set({ 0: 2 })
    h.tick()

    expect(h.poller.snapshot).toBe(first)
    expect(h.poller.snapshot['engineProcessCount']).toBe(2)
  })

  it('bumps the version only on real change', () => {
    const h = harness()
    h.poller.subscribe(() => {})

    h.set({ 0: 1 })
    h.tick()
    const afterChange = h.poller.version

    h.tick()
    expect(h.poller.version).toBe(afterChange)

    h.set({ 0: 2 })
    h.tick()
    expect(h.poller.version).toBe(afterChange + 1)
  })

  it('refreshes on demand without waiting for the interval', () => {
    const h = harness()
    h.poller.subscribe(() => {})
    h.set({ 0: 42 })
    h.poller.refresh()
    expect(h.poller.snapshot['engineProcessCount']).toBe(42)
  })

  it('ignores a double unsubscribe', () => {
    const h = harness()
    const keep = h.poller.subscribe(() => {})
    const release = h.poller.subscribe(() => {})
    release()
    release()
    expect(h.running).toBe(true)
    keep()
    expect(h.running).toBe(false)
  })

  it('stop() clears everything', () => {
    const h = harness()
    h.poller.subscribe(() => {})
    h.poller.stop()
    expect(h.running).toBe(false)
  })
})
