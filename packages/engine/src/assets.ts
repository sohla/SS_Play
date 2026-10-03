export interface SynthDefLoadResult {
  success: boolean
  error?: string
}

export interface SynthDefLoader {
  loadSynthDefs(names: string[]): Promise<Record<string, SynthDefLoadResult>>
}

export class SynthDefLoadError extends Error {
  override readonly name = 'SynthDefLoadError'

  constructor(
    readonly failures: { name: string; error: string }[],
    readonly loaded: string[],
  ) {
    super(
      `${failures.length} of ${failures.length + loaded.length} SynthDefs failed to load:\n` +
        failures.map(({ name, error }) => `  ${name}: ${error}`).join('\n'),
    )
  }
}

/**
 * Load SynthDefs and throw if any failed.
 *
 * `loadSynthDefs` resolves with a per-name result map and does **not** reject
 * when individual defs fail, so the obvious `await sonic.loadSynthDefs(names)`
 * reports success for a page whose instrument never loaded. The failure then
 * surfaces much later as a silent `/s_new` that produces nothing.
 */
export async function loadSynthDefsChecked(
  loader: SynthDefLoader,
  names: string[],
): Promise<string[]> {
  if (names.length === 0) return []

  const results = await loader.loadSynthDefs(names)
  const loaded: string[] = []
  const failures: { name: string; error: string }[] = []

  for (const name of names) {
    const result = results[name]

    if (!result) {
      failures.push({ name, error: 'no result reported' })
      continue
    }
    if (result.success) {
      loaded.push(name)
      continue
    }
    failures.push({ name, error: result.error ?? 'no reason given' })
  }

  if (failures.length > 0) throw new SynthDefLoadError(failures, loaded)
  return loaded
}
