export interface Capabilities {
  audioWorklet: boolean
  webWorker: boolean
  wasm: boolean
  sharedArrayBuffer: boolean
  atomics: boolean
  crossOriginIsolated: boolean
}

export type TransportMode = 'sab' | 'postMessage'

export interface CapabilityReport {
  capabilities: Capabilities
  /** The mode SuperSonic will negotiate for itself given these capabilities. */
  expectedMode: TransportMode
  /** Capabilities missing that would prevent the engine booting in any mode. */
  blocking: string[]
  /** Why the faster transport is unavailable, when it is. */
  sabUnavailable: string[]
}

/**
 * Reads the globals SuperSonic's own capability probe reads, without
 * constructing an engine. Safe to call before any user gesture, so a page can
 * report that it will be degraded on load rather than after someone clicks.
 */
export function probeCapabilities(scope: typeof globalThis = globalThis): CapabilityReport {
  const win = scope as typeof globalThis & { crossOriginIsolated?: boolean }

  const capabilities: Capabilities = {
    audioWorklet: typeof scope.AudioWorklet !== 'undefined',
    webWorker: typeof scope.Worker !== 'undefined',
    wasm: typeof scope.WebAssembly !== 'undefined',
    sharedArrayBuffer: typeof scope.SharedArrayBuffer !== 'undefined',
    atomics: typeof scope.Atomics !== 'undefined',
    crossOriginIsolated: win.crossOriginIsolated === true,
  }

  const blocking = (['audioWorklet', 'webWorker', 'wasm'] as const).filter(
    (key) => !capabilities[key],
  )

  const sabUnavailable = (['sharedArrayBuffer', 'atomics', 'crossOriginIsolated'] as const).filter(
    (key) => !capabilities[key],
  )

  return {
    capabilities,
    // Mirrors `options.mode || (crossOriginIsolated ? 'sab' : 'postMessage')`
    // in 0.88. We never pass `mode`, because forcing it is the only way to
    // reach the probe that throws.
    expectedMode: capabilities.crossOriginIsolated ? 'sab' : 'postMessage',
    blocking,
    sabUnavailable,
  }
}
