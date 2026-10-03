/** The shape the shipped typings describe, and 0.66 actually returned. */
export interface SynthDefLoadResult {
  success: boolean
  error?: string
}

/** The shape 0.88 actually returns, one entry per requested name. */
export interface SynthDefLoaded {
  name: string
  size: number
}

export type SynthDefLoadResponse =
  | SynthDefLoaded[]
  | Record<string, SynthDefLoadResult>

export interface SynthDefLoader {
  loadSynthDefs(names: string[]): Promise<SynthDefLoadResponse>
}

export class SynthDefLoadError extends Error {
  override readonly name = 'SynthDefLoadError'

  readonly failures: { name: string; error: string }[]
  readonly loaded: string[]
  readonly reportedKeys: string[]

  constructor(
    failures: { name: string; error: string }[],
    loaded: string[],
    reportedKeys: string[] = [],
  ) {
    super(
      `${failures.length} of ${failures.length + loaded.length} SynthDefs failed to load:\n` +
        failures.map(({ name, error }) => `  ${name}: ${error}`).join('\n') +
        (reportedKeys.length > 0 ? `\nkeys reported: ${reportedKeys.join(', ')}` : ''),
    )
    this.failures = failures
    this.loaded = loaded
    this.reportedKeys = reportedKeys
  }
}

/**
 * Load SynthDefs and return the names that loaded.
 *
 * Handles both result shapes on purpose, because the library's typings and its
 * runtime disagree:
 *
 *   - The shipped `.d.ts` declares `Record<string, { success, error? }>` and
 *     says nothing rejects, so each name has to be inspected.
 *   - 0.88 actually implements `Promise.all(names.map(loadSynthDef))`, which
 *     returns `{ name, size }[]` and rejects on the first failure.
 *
 * Reading the array as a record silently reports every name as missing, which
 * is exactly what happened the first time this ran against a real engine.
 * Accepting either shape means a version that flips back does not break the
 * page, and the names come out the same way regardless.
 */
export async function loadSynthDefsChecked(
  loader: SynthDefLoader,
  names: string[],
): Promise<string[]> {
  if (names.length === 0) return []

  const results = await loader.loadSynthDefs(names)

  if (Array.isArray(results)) {
    const missing = names.filter((_, index) => !results[index])
    if (missing.length > 0) {
      throw new SynthDefLoadError(
        missing.map((name) => ({ name, error: 'no entry at its index' })),
        names.filter((name) => !missing.includes(name)),
      )
    }
    // Prefer the name the engine extracted from the binary: a file whose
    // contents disagree with its filename is worth seeing rather than hiding.
    return results.map((result, index) => result.name ?? names[index] ?? '')
  }

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

  if (failures.length > 0) throw new SynthDefLoadError(failures, loaded, Object.keys(results))
  return loaded
}
