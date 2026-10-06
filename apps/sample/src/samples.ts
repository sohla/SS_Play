/**
 * What the store says it has.
 *
 * The index is written by `npm run samples` from the server's own directory, and
 * synthesised per request by tools/serve.mjs locally. Both produce this shape,
 * so the page cannot tell which one it is talking to — which is the point.
 */
export interface SampleEntry {
  name: string
  bytes: number
}

export interface Sample {
  /** What to show. */
  label: string
  /**
   * What to hand to `loadSample`.
   *
   * The resolution rule is the engine's, and worth stating because getting it
   * wrong produces a 404 at a URL with the base in it twice: a source beginning
   * `/` or `./` is used as given, and **anything else is joined to
   * `sampleBaseURL`**, which resolveEngineUrls sets to
   * `<page>/vendor/supersonic/samples/`.
   *
   * So the two kinds here are told apart by their first character, exactly as
   * the engine tells them apart — store samples are absolute, and the built-in
   * is a bare filename resolved against the page's own vendor directory.
   */
  url: string
  bytes: number
  /**
   * Shipped with the page rather than pushed to the store.
   *
   * There is one, so the page does something on a machine that has never run
   * `npm run samples`. Marked rather than hidden: a built-in sitting in the list
   * unlabelled would read as proof the store is working when it is empty.
   */
  builtin?: boolean
}

/**
 * Staged into the page's own vendor directory by the Vite preset.
 *
 * A bare filename, deliberately: that is the form the engine joins to
 * `sampleBaseURL`, which is where the preset puts it. Spelling the path out
 * instead asked for `vendor/supersonic/samples/vendor/supersonic/samples/…`.
 */
export const BUILTIN: Sample = {
  label: 'ambi_choir (built in)',
  url: 'ambi_choir.flac',
  bytes: 102586,
  builtin: true,
}

export const INDEX_URL = '/samples/index.json'

const kb = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`

export const sizeOf = kb

/**
 * Read the store's index, tolerating every way it can be absent.
 *
 * A missing store, an empty one, a 404 and a half-written file all mean the same
 * thing to this page — there is nothing to list — and none of them is an error
 * worth interrupting someone with. The built-in is always there, so the page is
 * never empty.
 */
export async function readStore(fetchImpl: typeof fetch = fetch): Promise<{
  samples: Sample[]
  reachable: boolean
}> {
  try {
    const response = await fetchImpl(INDEX_URL, { cache: 'no-store' })
    if (!response.ok) return { samples: [], reachable: false }

    const body = (await response.json()) as { samples?: unknown }
    if (!Array.isArray(body.samples)) return { samples: [], reachable: false }

    const samples = body.samples
      .filter((entry): entry is SampleEntry => {
        const candidate = entry as SampleEntry
        return typeof candidate?.name === 'string' && candidate.name.length > 0
      })
      .map((entry) => ({
        label: entry.name,
        // encodeURIComponent, not raw: a filename with a space or a # would
        // otherwise truncate at the fragment and 404 on the rest.
        url: `/samples/${encodeURIComponent(entry.name)}`,
        bytes: typeof entry.bytes === 'number' ? entry.bytes : 0,
      }))

    return { samples, reachable: true }
  } catch {
    // Offline, or no server at all. Same outcome as an empty store.
    return { samples: [], reachable: false }
  }
}
