export interface EngineUrls {
  baseURL: string
  coreBaseURL: string
  workerBaseURL: string
  wasmBaseURL: string
  wasmUrl: string
  workletUrl: string
  synthdefBaseURL: string
  sampleBaseURL: string
}

export interface ResolveEngineUrlsOptions extends Partial<Omit<EngineUrls, 'baseURL'>> {
  /** Vendor directory the engine was staged into, e.g. "/vendor/supersonic/". */
  base: string
}

/** Filenames inside the vendor tree, as of supersonic-scsynth 0.88.0. */
export const WASM_FILENAME = 'scsynth-nrt.wasm'
export const WORKLET_FILENAME = 'clockwork_audio_worklet.js'

/** The two workers 0.88 spawns in SAB mode. postMessage mode spawns neither. */
export const WORKER_FILENAMES = ['osc_in_worker.js', 'osc_out_log_sab_worker.js'] as const

const withSlash = (value: string) => (value.endsWith('/') ? value : `${value}/`)

/**
 * Build a fully explicit URL set.
 *
 * Every field is set rather than left to the library's defaults, because those
 * defaults are not trustworthy: the Clockwork layer defaults `wasmUrl` to
 * `clockwork-engine.wasm`, which does not exist in supersonic-scsynth-core, and
 * only works because the SuperSonic layer happens to override it. One layer
 * correcting another's wrong default is not something to build on, and a
 * renamed file would otherwise surface as an opaque boot failure.
 */
export function resolveEngineUrls(options: ResolveEngineUrlsOptions): EngineUrls {
  const base = withSlash(options.base)
  const coreBaseURL = withSlash(options.coreBaseURL ?? base)
  const workerBaseURL = withSlash(options.workerBaseURL ?? `${base}workers/`)
  const wasmBaseURL = withSlash(options.wasmBaseURL ?? `${coreBaseURL}wasm/`)

  return {
    baseURL: base,
    coreBaseURL,
    workerBaseURL,
    wasmBaseURL,
    wasmUrl: options.wasmUrl ?? `${wasmBaseURL}${WASM_FILENAME}`,
    workletUrl: options.workletUrl ?? `${workerBaseURL}${WORKLET_FILENAME}`,
    synthdefBaseURL: withSlash(options.synthdefBaseURL ?? `${base}synthdefs/`),
    sampleBaseURL: withSlash(options.sampleBaseURL ?? `${base}samples/`),
  }
}
