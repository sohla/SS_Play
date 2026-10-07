import type { Session } from './session.ts'

export interface LoadedSample {
  /** Filename as given, which is how the page refers to it. */
  name: string
  bufnum: number
  numFrames: number
  numChannels: number
  sampleRate: number
}

export interface LoadProgress {
  /** How many have finished. */
  done: number
  total: number
  /** The one being fetched and decoded right now, or null when finished. */
  loading: string | null
}

export interface LoadSampleSetOptions {
  session: Session
  /** Filenames in the shared store, without a path. */
  names: readonly string[]
  /** Where the store is served. */
  base?: string
  /**
   * Called before each load and once after the last.
   *
   * Worth wiring up rather than skipping: the loads are sequential, so a page
   * that stalls stalls on one identifiable file, and without this the only
   * symptom is a panel that sits there. A count is also the difference between
   * a slow load and a dead one, which is not otherwise visible to whoever is
   * holding the phone.
   */
  onProgress?: (progress: LoadProgress) => void
}

/**
 * Load a set of samples, one buffer each, and report what landed.
 *
 * A multisample instrument needs every buffer before it can play a note, and it
 * needs to know what is in each one — the frame count to sort by, the channel
 * count to check, the name to parse a pitch out of. `loadSample` returns all of
 * that per call; this just does them together and keeps the order.
 *
 * Sequential rather than parallel, deliberately. Each load fetches and decodes a
 * whole file, and four concurrent decodes of a few megabytes each is a spike in
 * memory on exactly the device least able to absorb one. The cost is a slower
 * boot, which is visible and survivable; the alternative is a crash that is
 * neither.
 *
 * Nothing here frees anything, because nothing can: measured on this project, a
 * loaded sample is never released — not by `/b_free`, not by overwriting the
 * buffer. So the number of samples a page loads is the number it pays for, for
 * the life of the page, and that is the budget to keep (see docs/SAMPLES.md).
 */
export async function loadSampleSet({
  session,
  names,
  base = '/samples/',
  onProgress,
}: LoadSampleSetOptions): Promise<LoadedSample[]> {
  const loaded: LoadedSample[] = []
  const total = names.length

  for (const name of names) {
    onProgress?.({ done: loaded.length, total, loading: name })

    const bufnum = session.buffers.alloc()
    // encodeURIComponent, not raw: a filename with a space or a # would
    // otherwise truncate at the fragment and 404 on the rest.
    let result
    try {
      result = await session.sonic.loadSample(bufnum, `${base}${encodeURIComponent(name)}`)
    } catch (cause) {
      // Named, because the generic message says only that a load failed. Which
      // file it was is the whole diagnosis: a 404 is a store that was not
      // pushed, a decode error is a format the browser will not take, and a
      // failure partway through a set that started fine is memory.
      throw new Error(`${name} (${loaded.length} of ${total} loaded): ${message(cause)}`, {
        cause,
      })
    }

    loaded.push({
      name,
      bufnum,
      numFrames: result.numFrames ?? 0,
      numChannels: result.numChannels ?? 0,
      sampleRate: result.sampleRate ?? 0,
    })
  }

  onProgress?.({ done: total, total, loading: null })
  return loaded
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
