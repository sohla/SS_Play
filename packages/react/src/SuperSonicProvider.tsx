import {
  createContext,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createSession, probeCapabilities, type CapabilityReport, type Session } from '@ss/engine'
import {
  createLogStore,
  createMetricsStore,
  createStatusStore,
  createTreeStore,
  type LogStore,
  type Status,
  type Store,
  type TreeStore,
} from './stores.ts'

export interface SuperSonicContextValue {
  /** The live session, or null before boot. Read in callbacks, not in render. */
  session(): Session | null
  boot(): Promise<void>
  probe: CapabilityReport
  statusStore: { subscribe(l: () => void): () => void; getSnapshot(): Status }
  metricsStore(): Store<number> | null
  treeStore(): TreeStore | null
  logStore(): LogStore | null
}

export const SuperSonicContext = createContext<SuperSonicContextValue | null>(null)

export interface SuperSonicProviderProps {
  /** Vendor directory the engine was staged into. */
  base: string
  synthdefs?: string[]
  children: ReactNode
}

/**
 * Owns the engine and the stores around it.
 *
 * Deliberately does **not** boot on mount. An AudioContext needs a user
 * gesture, so booting has to be something a button calls — a provider that
 * booted itself would work on a reload and fail on a fresh load, which is the
 * worst kind of intermittent.
 *
 * The context value is created once and never replaced, so the context itself
 * causes no renders. Everything that changes goes through an external store.
 */
export function SuperSonicProvider({ base, synthdefs = [], children }: SuperSonicProviderProps) {
  const session = useRef<Session | null>(null)
  const booting = useRef<Promise<void> | null>(null)

  const [stores, setStores] = useState<{
    metrics: Store<number>
    tree: TreeStore
    log: LogStore
  } | null>(null)

  const statusStore = useMemo(() => createStatusStore(), [])
  const probe = useMemo(() => probeCapabilities(), [])

  const boot = useCallback(async () => {
    // Idempotent and concurrent-safe: two clicks must not boot two engines.
    if (session.current) return
    if (booting.current) return booting.current

    booting.current = (async () => {
      statusStore.set({ phase: 'booting', error: null })

      const result = await createSession({ base, synthdefs })

      if (!result.ok) {
        statusStore.set({ phase: 'failed', error: result.error.message })
        booting.current = null
        return
      }

      session.current = result.session

      // Opt-in handle for tooling that drives the engine directly, such as the
      // UGen survey. Behind a query parameter so it is never present by
      // accident, and never on a deployed page unless someone asks for it.
      if (new URLSearchParams(location.search).has('debug')) {
        ;(window as unknown as Record<string, unknown>)['__ss'] = result.session
      }
      setStores({
        metrics: createMetricsStore(result.session),
        tree: createTreeStore(result.session),
        log: createLogStore(result.session),
      })

      statusStore.set({
        phase: result.session.degraded ? 'degraded' : 'ready',
        mode: result.session.mode,
        degradedReason: result.session.degraded?.reason ?? null,
        loadedSynthDefs: result.session.loadedSynthDefs,
        error: null,
      })

      booting.current = null
    })()

    return booting.current
  }, [base, synthdefs, statusStore])

  const value = useMemo<SuperSonicContextValue>(
    () => ({
      session: () => session.current,
      boot,
      probe,
      statusStore,
      metricsStore: () => stores?.metrics ?? null,
      treeStore: () => stores?.tree ?? null,
      logStore: () => stores?.log ?? null,
    }),
    [boot, probe, statusStore, stores],
  )

  return <SuperSonicContext.Provider value={value}>{children}</SuperSonicContext.Provider>
}
