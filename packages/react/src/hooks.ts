import { useContext, useEffect, useSyncExternalStore } from 'react'
import type { Session } from '@ss/engine'
import { SuperSonicContext, type SuperSonicContextValue } from './SuperSonicProvider.tsx'
import { metricsOf, type LogEntry, type MetricsSnapshotView, type Status, type Tree } from './stores.ts'

const EMPTY_METRICS: MetricsSnapshotView = {}
const EMPTY_LOG: LogEntry[] = []

function useSuperSonicContext(): SuperSonicContextValue {
  const context = useContext(SuperSonicContext)
  if (!context) throw new Error('useSuperSonic must be used inside a <SuperSonicProvider>')
  return context
}

/** Status, the boot action, and the pre-boot capability probe. */
export function useSuperSonic() {
  const context = useSuperSonicContext()
  const status = useSyncExternalStore(
    context.statusStore.subscribe,
    context.statusStore.getSnapshot,
    context.statusStore.getSnapshot,
  )

  return {
    status: status as Status,
    boot: context.boot,
    probe: context.probe,
    session: context.session,
  }
}

/**
 * The live session, or null before boot.
 *
 * Returned as a value for convenience in callbacks. Do not read engine state
 * from it during render — that is what the stores are for.
 */
export function useSession(): Session | null {
  return useSuperSonicContext().session()
}

/**
 * Engine metrics at 10Hz.
 *
 * Subscribing starts the poller; unmounting stops it, so a page that is not
 * showing metrics does no polling at all.
 */
export function useMetrics(): MetricsSnapshotView {
  const context = useSuperSonicContext()
  const store = context.metricsStore()

  const version = useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    store?.getSnapshot ?? (() => 0),
    () => 0,
  )

  const session = context.session()
  // The version is the reactive value; the object it points at is mutated in
  // place by the poller, which is what keeps a 10Hz feed allocation-free.
  void version
  return session ? (metricsOf(session) as MetricsSnapshotView) : EMPTY_METRICS
}

/** The scsynth node tree, polled at 2Hz and gated on its own version counter. */
export function useNodeTree(): Tree | null {
  const context = useSuperSonicContext()
  const store = context.treeStore()

  const version = useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    store?.getSnapshot ?? (() => -1),
    () => -1,
  )

  void version
  return store?.current() ?? null
}

/**
 * Watch an OSC address without re-rendering anything.
 *
 * This is the default for anything at audio rate — a canvas, a ref-written
 * node, a meter. Calling setState from the callback is the one thing that will
 * reliably destroy this page's frame rate.
 */
export function useOscTap(
  address: string,
  handler: (message: readonly unknown[]) => void,
  deps: unknown[] = [],
): void {
  const context = useSuperSonicContext()

  useEffect(() => {
    const session = context.session()
    if (!session) return
    return session.dispatcher.on(address, handler as never)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, context, ...deps])
}

export interface OscLog {
  entries: LogEntry[]
  total: number
  dropped: number
}

/**
 * A bounded, render-safe view of the OSC stream.
 *
 * The only hook here that re-renders on OSC traffic. Updates are coalesced to
 * one animation frame and throttled, so a burst costs a handful of renders of
 * one component rather than one render per message.
 */
export function useOscLog(): OscLog {
  const context = useSuperSonicContext()
  const store = context.logStore()

  const version = useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    store?.getSnapshot ?? (() => 0),
    () => 0,
  )

  void version
  return {
    entries: store?.entries() ?? EMPTY_LOG,
    total: store?.total ?? 0,
    dropped: store?.dropped ?? 0,
  }
}
