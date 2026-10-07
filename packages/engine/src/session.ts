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
  /**
   * The first audio bus that is not hardware.
   *
   * scsynth lays its buses out as outputs, then inputs, then private — so this
   * is `numOutputBusChannels + numInputBusChannels`. Derived here rather than
   * written as 4 in a page, because a page that guesses it wrong routes into the
   * hardware input and plays nothing, with no error to say why.
   */
  firstPrivateBus: number
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
  /** Overrides DEFAULT_MEMORY. */
  memory?: Record<string, number>
  /**
   * Passed to `new AudioContext`. Defaults to the smallest buffer the device
   * will give; see DEFAULT_AUDIO_CONTEXT_OPTIONS.
   */
  audioContextOptions?: AudioContextOptions
}

export type SessionResult = { ok: true; session: Session } | { ok: false; error: Error }

const DEFAULT_SCSYNTH_OPTIONS = { maxNodes: 1024, numBuffers: 1024 }

/**
 * The engine's own defaults for the two bus counts that decide where private
 * buses begin. Not passed to the engine — read here so firstPrivateBus is
 * correct without pinning values nothing else needs.
 */
const HARDWARE_CHANNELS = { out: 2, in: 2 }

/**
 * The WebAssembly memory layout, left at the engine's own defaults.
 *
 * Plumbed through but unset, because it is the knob behind a real failure and
 * the next person to look will want it reachable without re-deriving that it
 * exists. Runtime-only: read from the constructor options and absent from the
 * shipped `.d.ts`, so the runtime is the authority.
 *
 *   wasmHeapSize        24MB   scsynth's own heap
 *   memArenaSize        32MB   sample buffer pool
 *   ringBufferReserved   2MB
 *   outboxSize           4MB   guest to host
 *   guestMemorySize      4MB
 *   inboxSize            4MB   host to guest — synthdefs, sample data, OSC
 *   ----------------------------------
 *   totalMemory         70MB   and `initial` == `maximum`, so it cannot grow
 *
 * Two of these are not worth touching. `memArenaSize` boots the worklet and then
 * never answers `/notify`. `maxInboxSize` changes nothing at all, because the
 * allocation uses `totalMemory` for both bounds.
 *
 * `inboxSize` is the one that matters, and raising it is still the wrong fix for
 * the hang it causes — see loadSampleSet. A bigger ring buys slack on a device
 * that is already refusing a 70MB allocation; draining the one we have costs
 * nothing.
 */
const DEFAULT_MEMORY: Record<string, number> | undefined = undefined

/**
 * Ask for the smallest output buffer the device will give.
 *
 * SuperSonic asks for `latencyHint: 'interactive'`, which Chrome serves with a
 * 256-frame buffer — 5.8ms at 48kHz. A numeric hint of 0 gets 128 frames,
 * 2.9ms, measured on this machine across both. The engine itself turns out to
 * add almost nothing: press to first rendered sample is one render quantum, so
 * the output buffer is most of what is left to win.
 *
 * It is a hint, not a demand. A device that cannot keep up with 128 frames
 * gives a larger buffer rather than glitching, which is why this is safe to ask
 * for everywhere rather than per page.
 */
const DEFAULT_AUDIO_CONTEXT_OPTIONS: AudioContextOptions = { latencyHint: 0 }

/**
 * Boot an engine and assemble everything a page needs around it.
 *
 * Returns a result rather than throwing: a browser that cannot run the engine
 * at all, and an engine that failed to boot, are both things a page should
 * render an explanation for rather than crash on.
 */
export async function createSession(options: SessionOptions): Promise<SessionResult> {
  const {
    base,
    synthdefs = [],
    scsynthOptions = DEFAULT_SCSYNTH_OPTIONS,
    audioContextOptions = DEFAULT_AUDIO_CONTEXT_OPTIONS,
    memory = DEFAULT_MEMORY,
  } = options
  const urls = resolveEngineUrls({ base })

  const result = await bootEngine<Sonic>({
    create: (engineOptions) => new SuperSonic(engineOptions) as Sonic,
    urls,
    scsynthOptions,
    audioContextOptions,
    ...(memory ? { memory } : {}),
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
      firstPrivateBus: HARDWARE_CHANNELS.out + HARDWARE_CHANNELS.in,
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
