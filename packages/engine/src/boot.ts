import { probeCapabilities, type CapabilityReport, type TransportMode } from './capabilities.ts'
import type { EngineUrls } from './urls.ts'

export interface BootableEngine {
  init(): Promise<void>
  destroy(): Promise<void>
  readonly mode: TransportMode
}

export interface EngineFactoryOptions extends EngineUrls {
  /** Only ever set on the fallback attempt. The happy path omits it. */
  mode?: TransportMode
  scsynthOptions?: Record<string, number>
  audioContextOptions?: AudioContextOptions
}

export type EngineFactory<T extends BootableEngine> = (options: EngineFactoryOptions) => T

export interface Degradation {
  from: TransportMode
  to: TransportMode
  reason: string
  cause?: unknown
}

export type BootResult<T extends BootableEngine> =
  | { ok: true; engine: T; mode: TransportMode; degraded?: Degradation; report: CapabilityReport }
  | { ok: false; error: Error; report: CapabilityReport }

export interface BootOptions<T extends BootableEngine> {
  create: EngineFactory<T>
  urls: EngineUrls
  /**
   * Pinned rather than inherited: the 0.88 default is 1024, and a SynthDef
   * missing a doneAction exhausts that within seconds of a page going live.
   * Keeping the number here makes it visible and ours to change.
   */
  scsynthOptions?: Record<string, number>
  /**
   * Passed straight to `new AudioContext`. The library asks for
   * `latencyHint: 'interactive'`, which Chrome serves with a 256-frame buffer;
   * a numeric hint of 0 asks for the smallest the device will give, measured
   * here as 128 frames. Halving the buffer halves the time between a touch and
   * the sound of it, which on an instrument is the difference between
   * responsive and sluggish.
   */
  audioContextOptions?: AudioContextOptions
  scope?: typeof globalThis
}

/**
 * Boot the engine, reporting the transport it actually got.
 *
 * Deliberately never passes `mode`. SuperSonic 0.88 derives it itself from
 * `crossOriginIsolated`, and forcing it is the only way to reach the capability
 * probe that throws. The consequence is that a dropped COOP/COEP header no
 * longer fails loudly — it silently yields the slower transport and disables
 * audio capture — so the achieved mode is reported for the UI to show and for
 * the e2e suite to fail on.
 *
 * A single fallback retry covers the other way SAB can fail: not a missing
 * capability, but `init()` rejecting for a reason specific to shared memory,
 * such as an allocation failure under pressure or a 404 on a worker. Exactly
 * one retry, never a loop.
 */
export async function bootEngine<T extends BootableEngine>(
  options: BootOptions<T>,
): Promise<BootResult<T>> {
  const { create, urls, scsynthOptions, audioContextOptions, scope = globalThis } = options
  const report = probeCapabilities(scope)

  if (report.blocking.length > 0) {
    return {
      ok: false,
      report,
      error: new Error(
        `This browser cannot run the audio engine. Missing: ${report.blocking.join(', ')}.`,
      ),
    }
  }

  const base: EngineFactoryOptions = {
    ...urls,
    ...(scsynthOptions ? { scsynthOptions } : {}),
    ...(audioContextOptions ? { audioContextOptions } : {}),
  }

  let engine = create(base)
  try {
    await engine.init()
    return { ok: true, engine, mode: engine.mode, report }
  } catch (cause) {
    const attemptedMode = safeMode(engine) ?? report.expectedMode

    if (attemptedMode !== 'sab') {
      return { ok: false, report, error: asError(cause) }
    }

    await destroyQuietly(engine)

    engine = create({ ...base, mode: 'postMessage' })
    try {
      await engine.init()
      return {
        ok: true,
        engine,
        mode: engine.mode,
        report,
        degraded: {
          from: 'sab',
          to: 'postMessage',
          reason: 'SAB boot failed; retried once on the postMessage transport',
          cause,
        },
      }
    } catch (fallbackCause) {
      return { ok: false, report, error: asError(fallbackCause) }
    }
  }
}

function safeMode(engine: BootableEngine): TransportMode | null {
  try {
    return engine.mode
  } catch {
    // A engine that failed early may not have a usable mode accessor.
    return null
  }
}

async function destroyQuietly(engine: BootableEngine) {
  try {
    await engine.destroy()
  } catch {
    // The first engine already failed; a teardown error here would mask the
    // original cause, which is the thing worth reporting.
  }
}

const asError = (cause: unknown) =>
  cause instanceof Error ? cause : new Error(String(cause), { cause })
