import type { OscMessage, Session } from '@ss/engine'

/** The shape `useSyncExternalStore` wants. */
export interface Store<T> {
  subscribe(listener: () => void): () => void
  getSnapshot(): T
}

export type Phase = 'idle' | 'booting' | 'ready' | 'degraded' | 'failed'

export interface Status {
  phase: Phase
  mode: 'sab' | 'postMessage' | null
  degradedReason: string | null
  error: string | null
  loadedSynthDefs: string[]
}

const IDLE: Status = {
  phase: 'idle',
  mode: null,
  degradedReason: null,
  error: null,
  loadedSynthDefs: [],
}

/**
 * Engine status.
 *
 * Changes a handful of times in a session, so it holds a frozen object and
 * replaces it only on a real change — `useSyncExternalStore` compares with
 * `Object.is` and will loop forever if handed a fresh object every read.
 */
export function createStatusStore() {
  let snapshot: Status = IDLE
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const listener of [...listeners]) listener()
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    set(next: Partial<Status>) {
      const merged = { ...snapshot, ...next }
      if ((Object.keys(merged) as (keyof Status)[]).every((key) => merged[key] === snapshot[key])) {
        return
      }
      snapshot = Object.freeze(merged)
      emit()
    },
    reset() {
      snapshot = IDLE
      emit()
    },
  }
}

export type StatusStore = ReturnType<typeof createStatusStore>

/**
 * Metrics.
 *
 * The snapshot is the poller's **version number**, not its values. The poller
 * mutates one object in place and bumps the version only when something
 * actually changed, so a tick that moves nothing costs no render and no
 * allocation. Components read the values through `metricsOf`.
 */
export function createMetricsStore(session: Session): Store<number> {
  return {
    subscribe: (listener) => session.metrics.subscribe(listener),
    getSnapshot: () => session.metrics.version,
  }
}

export type MetricsSnapshotView = Readonly<Record<string, number | string>>

export const metricsOf = (session: Session): MetricsSnapshotView => session.metrics.snapshot

/**
 * The scsynth node tree.
 *
 * Polled, because nothing announces a change. The tree carries its own version
 * counter, so an idle page re-renders nothing even though the poll continues.
 */
export interface TreeNode {
  id: number
  type: 'group' | 'synth'
  defName?: string
  children?: TreeNode[]
}

export interface Tree {
  nodeCount: number
  version: number
  root: TreeNode
}

export interface TreeStore extends Store<number> {
  /** Latest tree, or null before the first poll. Read during render. */
  current(): Tree | null
}

export function createTreeStore(session: Session, hz = 2): TreeStore {
  let version = -1
  let tree: Tree | null = null
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | null = null

  const tick = () => {
    const next = session.sonic.getTree() as unknown as Tree
    // The tree carries its own version, so an idle page re-renders nothing even
    // though the poll keeps running.
    if (next.version === version) return
    version = next.version
    tree = next
    for (const listener of [...listeners]) listener()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      if (timer === null) {
        timer = setInterval(tick, 1000 / hz)
        tick()
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer !== null) {
          clearInterval(timer)
          timer = null
        }
      }
    },
    getSnapshot: () => version,
    current: () => tree,
  }
}

export interface LogEntry {
  direction: 'in' | 'out'
  address: string
  args: unknown[]
  at: number
}

/**
 * A bounded OSC log.
 *
 * `in` and `out` can run at audio rate, so messages land in a preallocated ring
 * written entirely outside React. The version bump is coalesced to one animation
 * frame and then throttled, which turns a 2000 msg/s burst into a handful of
 * renders of one component rather than a frame-rate collapse.
 */
export function createLogStore(session: Session, capacity = 512, maxHz = 10) {
  const ring: (LogEntry | undefined)[] = Array.from({ length: capacity })
  const listeners = new Set<() => void>()

  let writeIndex = 0
  let total = 0
  let version = 0
  let frame: number | null = null
  let lastEmit = 0
  let unsubscribe: (() => void) | null = null

  const schedule = () => {
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      const now = performance.now()
      if (now - lastEmit < 1000 / maxHz) {
        schedule()
        return
      }
      lastEmit = now
      version++
      for (const listener of [...listeners]) listener()
    })
  }

  const write = (direction: 'in' | 'out', message: OscMessage) => {
    const [address, ...args] = message
    ring[writeIndex] = { direction, address, args, at: performance.now() }
    writeIndex = (writeIndex + 1) % capacity
    total++
    schedule()
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)

      if (!unsubscribe) {
        const offIn = session.sonic.on('in', (message) => write('in', message as OscMessage))
        const offOut = session.sonic.on('out', (message) => write('out', message as OscMessage))
        unsubscribe = () => {
          offIn()
          offOut()
        }
      }

      return () => {
        listeners.delete(listener)
        if (listeners.size > 0) return
        unsubscribe?.()
        unsubscribe = null
        if (frame !== null) cancelAnimationFrame(frame)
        frame = null
      }
    },
    getSnapshot: () => version,
    /** Oldest first. Called during render, so it must not allocate per message. */
    entries(): LogEntry[] {
      const out: LogEntry[] = []
      const count = Math.min(total, capacity)
      for (let i = 0; i < count; i++) {
        const entry = ring[(writeIndex - count + i + capacity) % capacity]
        if (entry) out.push(entry)
      }
      return out
    },
    get dropped() {
      return Math.max(0, total - capacity)
    },
    get total() {
      return total
    },
  }
}

export type LogStore = ReturnType<typeof createLogStore>
