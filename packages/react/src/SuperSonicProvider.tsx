import {
  createContext,
  useCallback,
  useEffect,
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

  /**
   * Give the engine back, on unmount and on the way out of the page.
   *
   * Nothing did this before, and the engine is not small: `getInfo` reports
   * around 70MB of WebAssembly memory per boot, none of it visible in the JS
   * heap. On a desktop the browser reclaims it when the document goes; on a
   * phone, where the per-tab budget is a fraction of that, several pages in a
   * session is enough to be killed for it.
   *
   * Both hooks are needed and neither is sufficient. React unmount covers a
   * component going away while the page stays; `pagehide` covers navigating
   * between pages, which on this site is a full document load and never
   * unmounts anything. `pagehide` rather than `unload`, because Safari does not
   * fire `unload` reliably and treats a page with one as ineligible for the
   * back/forward cache.
   *
   * dispose() stops the metrics poller, drops every OSC subscription and
   * destroys the engine, in that order — the poller must stop before the
   * engine it reads from goes.
   */
  useEffect(() => {
    const release = () => {
      const live = session.current
      session.current = null
      // Deliberately not awaited: `pagehide` gives no time for a promise, and
      // the teardown's first act is to stop the pollers, which is the part that
      // has to happen before the document goes.
      void live?.dispose()
    }

    window.addEventListener('pagehide', release)
    return () => {
      window.removeEventListener('pagehide', release)
      release()
    }
  }, [])

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
