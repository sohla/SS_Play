import { describe, expect, it, vi } from 'vitest'
import { Dispatcher, type OscMessage, type ReplySource } from '../src/dispatcher'

/** Stands in for SuperSonic, and counts listeners so leaks are visible. */
function fakeSource() {
  const listeners = new Set<(message: OscMessage) => void>()

  const source: ReplySource = {
    on(_event, callback) {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
  }

  return {
    source,
    get listenerCount() {
      return listeners.size
    },
    emit(message: OscMessage) {
      for (const listener of [...listeners]) listener(message)
    },
  }
}

describe('a single underlying subscription', () => {
  it('attaches once no matter how many addresses are watched', () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    dispatcher.on('/done', () => {})
    dispatcher.on('/fail', () => {})
    dispatcher.on('/n_end', () => {})

    // `in` can run at audio rate; one listener per consumer would be the most
    // likely performance bug in this layer.
    expect(fake.listenerCount).toBe(1)
    expect(dispatcher.handlerCount).toBe(3)
  })

  it('attaches nothing until something is watching', () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)
    expect(fake.listenerCount).toBe(0)
    expect(dispatcher.attached).toBe(false)
  })

  it('detaches when the last handler goes', () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    const releaseA = dispatcher.on('/done', () => {})
    const releaseB = dispatcher.on('/fail', () => {})

    releaseA()
    expect(fake.listenerCount).toBe(1)

    releaseB()
    expect(fake.listenerCount).toBe(0)
    expect(dispatcher.attached).toBe(false)
  })

  it('returns to baseline after every subscription is released', () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    const releases = Array.from({ length: 50 }, (_, n) => dispatcher.on(`/addr${n % 5}`, () => {}))
    expect(dispatcher.handlerCount).toBe(50)

    for (const release of releases) release()
    expect(dispatcher.handlerCount).toBe(0)
    expect(fake.listenerCount).toBe(0)
  })

  it('ignores a double release', () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    const keep = dispatcher.on('/keep', () => {})
    const release = dispatcher.on('/done', () => {})
    release()
    release()

    expect(dispatcher.handlerCount).toBe(1)
    keep()
  })
})

describe('routing', () => {
  it('delivers only to handlers for that address', () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    const onDone = vi.fn()
    const onFail = vi.fn()
    dispatcher.on('/done', onDone)
    dispatcher.on('/fail', onFail)

    fake.emit(['/done', '/d_recv'])

    expect(onDone).toHaveBeenCalledWith(['/done', '/d_recv'])
    expect(onFail).not.toHaveBeenCalled()
  })

  it('delivers to every handler on the same address', () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    const first = vi.fn()
    const second = vi.fn()
    dispatcher.on('/tr', first)
    dispatcher.on('/tr', second)

    fake.emit(['/tr', 1000, 0, 1])

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })

  it('survives a handler that unsubscribes itself mid-delivery', () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    const second = vi.fn()
    const release = dispatcher.on('/tr', () => release())
    dispatcher.on('/tr', second)

    expect(() => fake.emit(['/tr', 1, 0, 0])).not.toThrow()
    expect(second).toHaveBeenCalledOnce()
  })

  it('drops messages for addresses nobody watches', () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)
    dispatcher.on('/done', () => {})
    expect(() => fake.emit(['/status.reply', 1, 2])).not.toThrow()
  })

  it('once fires a single time and releases itself', () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    const handler = vi.fn()
    dispatcher.once('/done', handler)

    fake.emit(['/done', 'a'])
    fake.emit(['/done', 'b'])

    expect(handler).toHaveBeenCalledOnce()
    expect(dispatcher.handlerCount).toBe(0)
  })
})

describe('waiting for a reply', () => {
  it('resolves on a match', async () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    const pending = dispatcher.wait('/n_end', (message) => message[1] === 1001)
    fake.emit(['/n_end', 999])
    fake.emit(['/n_end', 1001])

    await expect(pending).resolves.toEqual(['/n_end', 1001])
    expect(dispatcher.handlerCount).toBe(0)
  })

  it('rejects on timeout rather than hanging', async () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    await expect(dispatcher.wait('/never', () => true, { timeoutMs: 10 })).rejects.toThrow(
      /Timed out after 10ms/,
    )
    expect(dispatcher.handlerCount).toBe(0)
  })

  it('honours an abort signal', async () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)
    const controller = new AbortController()

    const pending = dispatcher.wait('/never', () => true, { signal: controller.signal })
    controller.abort(new Error('page navigated away'))

    await expect(pending).rejects.toThrow('page navigated away')
    expect(dispatcher.handlerCount).toBe(0)
  })

  it('waitForNodeEnd matches on the node id', async () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    const pending = dispatcher.waitForNodeEnd(1001)
    fake.emit(['/n_end', 1002])
    fake.emit(['/n_end', 1001, 0, -1, -1, 0])

    await expect(pending).resolves.toEqual(['/n_end', 1001, 0, -1, -1, 0])
  })
})

describe('waitForDone', () => {
  it('resolves on the matching /done', async () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    const pending = dispatcher.waitForDone('/d_recv')
    fake.emit(['/done', '/b_allocRead'])
    fake.emit(['/done', '/d_recv'])

    await expect(pending).resolves.toEqual(['/done', '/d_recv'])
    expect(dispatcher.handlerCount).toBe(0)
  })

  it('rejects on /fail with the reason scsynth gave', async () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    const pending = dispatcher.waitForDone('/d_recv')
    fake.emit(['/fail', '/d_recv', 'SynthDef not found'])

    await expect(pending).rejects.toThrow('/d_recv failed: SynthDef not found')
    expect(dispatcher.handlerCount).toBe(0)
  })

  it('ignores a failure for a different command', async () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    const pending = dispatcher.waitForDone('/d_recv', { timeoutMs: 20 })
    fake.emit(['/fail', '/b_free', 'wrong one'])

    await expect(pending).rejects.toThrow(/Timed out/)
  })
})

describe('triggers', () => {
  it('filters by node and trigger id', () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    const handler = vi.fn()
    dispatcher.onTrigger(handler, { nodeId: 1001, triggerId: 3 })

    fake.emit(['/tr', 1002, 3, 0.5])
    fake.emit(['/tr', 1001, 9, 0.5])
    fake.emit(['/tr', 1001, 3, 0.75])

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(1001, 3, 0.75)
  })

  it('passes everything through when unfiltered', () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    const handler = vi.fn()
    dispatcher.onTrigger(handler)

    fake.emit(['/tr', 1, 0, 0])
    fake.emit(['/tr', 2, 1, 1])

    expect(handler).toHaveBeenCalledTimes(2)
  })
})

describe('disposal', () => {
  it('detaches and refuses further subscriptions', () => {
    const fake = fakeSource()
    const dispatcher = new Dispatcher(fake.source)

    dispatcher.on('/done', () => {})
    dispatcher.dispose()

    expect(fake.listenerCount).toBe(0)
    expect(dispatcher.handlerCount).toBe(0)
    expect(() => dispatcher.on('/done', () => {})).toThrow(/disposed/)
  })
})
