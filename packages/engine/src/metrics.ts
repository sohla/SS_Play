export interface MetricDefinition {
  offset: number
  type?: string
  unit?: string
  values?: string[]
}

export interface MetricsSchema {
  metrics: Record<string, MetricDefinition>
}

export interface MetricsSource {
  getMetricsArray(): ArrayLike<number>
}

export type MetricsSnapshot = Record<string, number | string>

/**
 * Build a reader that maps the flat metrics array to named values.
 *
 * Offsets come from the runtime schema on every call rather than from a table
 * in this file. Two reasons, both load-bearing: the shipped typings disagree
 * with the runtime about key names (`getMetrics()` returns a different shape
 * again, which is why nothing here uses it), and the offsets are not
 * contiguous — 73 metrics span offsets 0..76 — so neither the names nor the
 * array length can be assumed.
 */
export function createMetricsReader(schema: MetricsSchema) {
  const entries = Object.entries(schema.metrics)

  return function read(array: ArrayLike<number>): MetricsSnapshot {
    const snapshot: MetricsSnapshot = {}

    for (const [name, definition] of entries) {
      const raw = array[definition.offset]
      if (raw === undefined) continue

      // Enum metrics carry their labels; reporting "sab" beats reporting 0.
      if (definition.type === 'enum' && definition.values) {
        snapshot[name] = definition.values[raw] ?? raw
        continue
      }

      snapshot[name] = raw
    }

    return snapshot
  }
}

export interface PollerOptions {
  source: MetricsSource
  schema: MetricsSchema
  /** Defaults to 10Hz, matching the metrics component SuperSonic ships. */
  hz?: number
  setInterval?: typeof globalThis.setInterval
  clearInterval?: typeof globalThis.clearInterval
}

export interface MetricsPoller {
  /** Latest values. The same object identity is reused between ticks. */
  readonly snapshot: Readonly<MetricsSnapshot>
  /** Bumped only when at least one value actually changed. */
  readonly version: number
  subscribe(listener: () => void): () => void
  /** Read immediately, outside the polling schedule. */
  refresh(): void
  stop(): void
}

/**
 * Poll metrics on one shared interval.
 *
 * Metrics are poll-only — SuperSonic emits no metrics event. The timer runs
 * only while something is subscribed, so an unmounted panel costs nothing, and
 * the snapshot object is mutated in place with a version counter beside it so
 * a React external store can invalidate without allocating per tick.
 */
export function createMetricsPoller(options: PollerOptions): MetricsPoller {
  const { source, schema, hz = 10 } = options
  const start = options.setInterval ?? globalThis.setInterval
  const stopTimer = options.clearInterval ?? globalThis.clearInterval

  const read = createMetricsReader(schema)
  const snapshot: MetricsSnapshot = {}
  const listeners = new Set<() => void>()

  let version = 0
  let timer: ReturnType<typeof setInterval> | null = null

  const tick = () => {
    const next = read(source.getMetricsArray())

    let changed = false
    for (const [name, value] of Object.entries(next)) {
      if (snapshot[name] !== value) {
        snapshot[name] = value
        changed = true
      }
    }

    if (!changed) return
    version++
    for (const listener of [...listeners]) listener()
  }

  const ensureRunning = () => {
    timer ??= start(tick, 1000 / hz)
  }

  const ensureStopped = () => {
    if (timer === null) return
    stopTimer(timer)
    timer = null
  }

  return {
    get snapshot() {
      return snapshot
    },
    get version() {
      return version
    },
    subscribe(listener) {
      listeners.add(listener)
      ensureRunning()

      let released = false
      return () => {
        if (released) return
        released = true
        listeners.delete(listener)
        if (listeners.size === 0) ensureStopped()
      }
    },
    refresh: tick,
    stop() {
      listeners.clear()
      ensureStopped()
    },
  }
}
