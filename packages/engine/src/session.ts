import { SuperSonic } from 'supersonic-scsynth'
import { BufAllocator } from './buffers.ts'
import { bootEngine, type Degradation } from './boot.ts'
import { Dispatcher, enableNodeNotifications } from './dispatcher.ts'
import { createMetricsPoller, type MetricsPoller } from './metrics.ts'
import { loadSynthDefsChecked } from './assets.ts'
import { resolveEngineUrls } from './urls.ts'
import type { TransportMode } from './capabilities.ts'

export type Sonic = InstanceType<typeof SuperSonic>

export interface Session {
  sonic: Sonic
  dispatcher: Dispatcher
  buffers: BufAllocator
  metrics: MetricsPoller
  /** The transport actually achieved, not the one asked for. */
  mode: TransportMode
  degraded?: Degradation
  loadedSynthDefs: string[]
  dispose(): Promise<void>
}

export interface SessionOptions {
  /** Vendor directory the engine was staged into. */
  base: string
  /** SynthDefs to load before the session is considered ready. */
  synthdefs?: string[]
  /**
   * Pinned rather than inherited. The 0.88 default is 1024 nodes, which a
   * SynthDef missing a doneAction exhausts within seconds — and the symptom is
   * a silent `/s_new` rather than an error.
   */
  scsynthOptions?: { maxNodes: number; numBuffers: number }
}

export type SessionResult = { ok: true; session: Session } | { ok: false; error: Error }

const DEFAULT_SCSYNTH_OPTIONS = { maxNodes: 1024, numBuffers: 1024 }

/**
 * Boot an engine and assemble everything a page needs around it.
 *
 * Returns a result rather than throwing: a browser that cannot run the engine
 * at all, and an engine that failed to boot, are both things a page should
 * render an explanation for rather than crash on.
 */
export async function createSession(options: SessionOptions): Promise<SessionResult> {
  const { base, synthdefs = [], scsynthOptions = DEFAULT_SCSYNTH_OPTIONS } = options
  const urls = resolveEngineUrls({ base })

  const result = await bootEngine<Sonic>({
    create: (engineOptions) => new SuperSonic(engineOptions) as Sonic,
    urls,
    scsynthOptions,
  })

  if (!result.ok) return { ok: false, error: result.error }

  const sonic = result.engine
  const dispatcher = new Dispatcher(sonic as never)

  try {
    // scsynth sends /n_go and /n_end only to clients that registered, and
    // SuperSonic never registers. Without this nothing can wait on a node.
    await enableNodeNotifications(sonic as never, dispatcher)
  } catch (error) {
    await sonic.destroy()
    return { ok: false, error: error as Error }
  }

  let loadedSynthDefs: string[] = []
  try {
    loadedSynthDefs = await loadSynthDefsChecked(sonic as never, synthdefs)
  } catch (error) {
    await sonic.destroy()
    return { ok: false, error: error as Error }
  }

  const metrics = createMetricsPoller({
    source: sonic as never,
    schema: SuperSonic.getMetricsSchema() as never,
  })

  return {
    ok: true,
    session: {
      sonic,
      dispatcher,
      buffers: new BufAllocator(scsynthOptions.numBuffers),
      metrics,
      mode: result.mode,
      ...(result.degraded ? { degraded: result.degraded } : {}),
      loadedSynthDefs,
      async dispose() {
        metrics.stop()
        dispatcher.dispose()
        await sonic.destroy()
      },
    },
  }
}
