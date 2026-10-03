import { SuperSonic } from 'supersonic-scsynth'
import {
  BufAllocator,
  Dispatcher,
  enableNodeNotifications,
  bootEngine,
  createMetricsPoller,
  ctl,
  loadSynthDefsChecked,
  resolveEngineUrls,
  type BootResult,
  type Degradation,
  type MetricsPoller,
  type TransportMode,
} from '@ss/engine'

export const SYNTHDEFS = ['sonic-pi-beep'] as const

export interface Session {
  sonic: InstanceType<typeof SuperSonic>
  dispatcher: Dispatcher
  buffers: BufAllocator
  metrics: MetricsPoller
  mode: TransportMode
  degraded?: Degradation
  loadedSynthDefs: string[]
}

const urls = resolveEngineUrls({ base: __SS_ENGINE_BASE__ })

/**
 * Pinned rather than inherited. The 0.88 default is 1024 nodes, which a
 * SynthDef missing a doneAction exhausts within seconds, and the symptom is a
 * silent /s_new rather than an error.
 */
const scsynthOptions = { maxNodes: 1024, numBuffers: 1024 }

export async function startSession(): Promise<
  { ok: true; session: Session } | { ok: false; error: Error }
> {
  const result: BootResult<InstanceType<typeof SuperSonic>> = await bootEngine({
    create: (options) => new SuperSonic(options) as InstanceType<typeof SuperSonic>,
    urls,
    scsynthOptions,
  })

  if (!result.ok) return { ok: false, error: result.error }

  const sonic = result.engine
  const dispatcher = new Dispatcher(sonic as never)

  // scsynth only sends /n_go and /n_end to clients that registered for them,
  // and SuperSonic does not register. Without this nothing can wait on a node.
  await enableNodeNotifications(sonic as never, dispatcher)

  let loadedSynthDefs: string[] = []
  try {
    loadedSynthDefs = await loadSynthDefsChecked(sonic as never, [...SYNTHDEFS])
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
    },
  }
}

/** Fire a note and resolve when scsynth reports the node freed. */
export async function playBeep(session: Session, note: number, durationS = 1): Promise<number> {
  const nodeId = session.sonic.nextNodeId()

  session.sonic.send(
    '/s_new',
    'sonic-pi-beep',
    nodeId,
    0,
    0,
    ...ctl({ note, amp: 0.4, attack: 0.01, sustain: durationS, release: 0.3 }),
  )

  // Waiting on /n_end rather than a timer: the node frees itself via its
  // envelope's doneAction, and sleeping instead is what makes audio tests flaky.
  await session.dispatcher.waitForNodeEnd(nodeId, { timeoutMs: (durationS + 3) * 1000 })
  return nodeId
}
