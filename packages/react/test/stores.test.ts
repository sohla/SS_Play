// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  createLogStore,
  createMetricsStore,
  createStatusStore,
  createTreeStore,
  type LogStore,
} from '../src/stores.ts'

/** Enough of a Session for the stores, with hooks to drive them. */
function fakeSession() {
  const listeners = new Map<string, Set<(message: unknown) => void>>()
  let metricsVersion = 0
  const metricsSnapshot: Record<string, number> = {}
  const metricsListeners = new Set<() => void>()
  let treeVersion = 0
  let nodeCount = 1

  const session = {
    sonic: {
      on(event: string, callback: (message: unknown) => void) {
        const set = listeners.get(event) ?? new Set()
        set.add(callback)
        listeners.set(event, set)
        return () => set.delete(callback)
      },
      getTree: () => ({ version: treeVersion, nodeCount, root: { id: 0, type: 'group' } }),
    },
    metrics: {
      get version() {
        return metricsVersion
      },
      get snapshot() {
        return metricsSnapshot
      },
      subscribe(listener: () => void) {
        metricsListeners.add(listener)
        return () => metricsListeners.delete(listener)
      },
    },
  }

  return {
    session: session as never,
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    emit(event: string, message: unknown) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(message)
    },
    bumpMetrics(values: Record<string, number>) {
      Object.assign(metricsSnapshot, values)
      metricsVersion++
      for (const listener of [...metricsListeners]) listener()
    },
    bumpTree(count: number) {
      treeVersion++
      nodeCount = count
    },
  }
}

describe('status store', () => {
  it('keeps one object identity until something changes', () => {
    // useSyncExternalStore compares with Object.is and loops forever if handed
    // a fresh object on every read.
    const store = createStatusStore()
    const first = store.getSnapshot()
    expect(store.getSnapshot()).toBe(first)

    store.set({ phase: 'booting' })
    const second = store.getSnapshot()
    expect(second).not.toBe(first)
    expect(store.getSnapshot()).toBe(second)
  })

  it('does not notify when a set changes nothing', () => {
    const store = createStatusStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.set({ phase: 'booting' })
    expect(listener).toHaveBeenCalledOnce()

    store.set({ phase: 'booting' })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('merges partial updates', () => {
    const store = createStatusStore()
    store.set({ phase: 'ready', mode: 'sab' })
    store.set({ loadedSynthDefs: ['a'] })

    expect(store.getSnapshot()).toMatchObject({
      phase: 'ready',
      mode: 'sab',
      loadedSynthDefs: ['a'],
    })
  })
})

describe('metrics store', () => {
  it('snapshots a version number, not the values', () => {
    // The poller mutates one object in place, so returning it would make every
    // read look unchanged. The version is what React can compare.
    const fake = fakeSession()
    const store = createMetricsStore(fake.session)

    expect(typeof store.getSnapshot()).toBe('number')
    const before = store.getSnapshot()

    fake.bumpMetrics({ engineProcessCount: 1 })
    expect(store.getSnapshot()).toBeGreaterThan(before)
  })

  it('forwards subscriptions to the poller', () => {
    const fake = fakeSession()
    const store = createMetricsStore(fake.session)
    const listener = vi.fn()

    const release = store.subscribe(listener)
    fake.bumpMetrics({ a: 1 })
    expect(listener).toHaveBeenCalledOnce()

    release()
    fake.bumpMetrics({ a: 2 })
    expect(listener).toHaveBeenCalledOnce()
  })
})

describe('tree store', () => {
  it('polls only while something is subscribed', () => {
    vi.useFakeTimers()
    const fake = fakeSession()
    const store = createTreeStore(fake.session, 10)

    const release = store.subscribe(() => {})
    expect(store.current()).not.toBeNull()

    release()
    const settled = store.getSnapshot()
    fake.bumpTree(5)
    vi.advanceTimersByTime(500)
    // No subscribers, so no polling: the version must not have moved.
    expect(store.getSnapshot()).toBe(settled)
    vi.useRealTimers()
  })

  it('notifies only when the tree version moves', () => {
    vi.useFakeTimers()
    const fake = fakeSession()
    const store = createTreeStore(fake.session, 10)
    const listener = vi.fn()
    store.subscribe(listener)

    vi.advanceTimersByTime(300)
    const quiet = listener.mock.calls.length

    fake.bumpTree(9)
    vi.advanceTimersByTime(200)
    expect(listener.mock.calls.length).toBeGreaterThan(quiet)
    expect(store.current()?.nodeCount).toBe(9)
    vi.useRealTimers()
  })
})

describe('log store', () => {
  const message = (address: string) => [address, 1, 2]

  function subscribed(): [LogStore, () => void, ReturnType<typeof fakeSession>] {
    const fake = fakeSession()
    const store = createLogStore(fake.session, 4, 1000)
    const release = store.subscribe(() => {})
    return [store, release, fake]
  }

  it('attaches to in and out only while subscribed', () => {
    const fake = fakeSession()
    const store = createLogStore(fake.session)
    expect(fake.listenerCount('in')).toBe(0)

    const release = store.subscribe(() => {})
    expect(fake.listenerCount('in')).toBe(1)
    expect(fake.listenerCount('out')).toBe(1)

    release()
    expect(fake.listenerCount('in')).toBe(0)
    expect(fake.listenerCount('out')).toBe(0)
  })

  it('keeps the newest entries and reports what it dropped', () => {
    const [store, release, fake] = subscribed()

    for (const address of ['/a', '/b', '/c', '/d', '/e', '/f']) {
      fake.emit('in', message(address))
    }

    // Capacity 4, six written: the ring must not grow, and the loss must be
    // visible rather than silent.
    expect(store.entries().map((e) => e.address)).toEqual(['/c', '/d', '/e', '/f'])
    expect(store.total).toBe(6)
    expect(store.dropped).toBe(2)
    release()
  })

  it('records direction', () => {
    const [store, release, fake] = subscribed()
    fake.emit('in', message('/n_end'))
    fake.emit('out', message('/s_new'))

    expect(store.entries().map((e) => e.direction)).toEqual(['in', 'out'])
    release()
  })

  it('does not notify once per message', async () => {
    // The whole point: a burst must cost a handful of renders, not one per
    // message. Updates are coalesced to an animation frame.
    const fake = fakeSession()
    const store = createLogStore(fake.session, 1024, 1000)
    const listener = vi.fn()
    store.subscribe(listener)

    for (let n = 0; n < 500; n++) fake.emit('in', message(`/burst${n}`))

    expect(listener).not.toHaveBeenCalled()
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(listener.mock.calls.length).toBeLessThanOrEqual(2)
    expect(store.total).toBe(500)
  })

  it('writes nothing once released', () => {
    const [store, release, fake] = subscribed()
    fake.emit('in', message('/before'))
    release()
    fake.emit('in', message('/after'))

    expect(store.entries().map((e) => e.address)).toEqual(['/before'])
  })
})
