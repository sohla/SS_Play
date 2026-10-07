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
  /** Bytes of decoded audio accepted so far, at the context's sample rate. */
  decodedBytes: number
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
  /**
   * Give up on a single load after this long.
   *
   * Not a nicety. `loadSample` ends with `await prepared.allocationComplete`,
   * which waits for the engine to acknowledge the allocation — and when the
   * engine cannot satisfy it, nothing is sent and that promise never settles.
   * The result is a page that waits forever with no error to show, which is
   * exactly what an iPhone did at the fourth sample while desktop Chrome loaded
   * the same set without complaint.
   *
   * A timeout converts that into a failure someone can read. Generous, because
   * a slow phone on a slow connection is not the thing being caught.
   */
  timeoutMs?: number
}

/**
 * Load a set of samples, one buffer each, and report what landed.
 *
 * A multisample instrument needs every buffer before it can play a note, and it
 * needs to know what is in each one — the frame count to sort by, the channel
 * count to check, the name to parse a pitch out of. `loadSample` returns all of
 * that per call; this just does them together and keeps the order.
 *
 * Sequential, and each load waits for the engine to catch up before the next is
 * queued. Both parts matter, and the second one was learned the hard way.
 *
 * Sequential because each load fetches and decodes a whole file, and four
 * concurrent decodes of a few megabytes each is a memory spike on exactly the
 * device least able to absorb one.
 *
 * And `sync()` between loads because `loadSample` resolving means the audio has
 * been *queued* for the engine, not consumed by it. The host-to-guest channel is
 * a 4MB ring buffer; a loop that queues faster than the engine drains fills it,
 * and a write with nowhere to go waits forever rather than failing. On desktop
 * Chrome the engine keeps up and this is invisible — a 1MB inbox still loads
 * 3.7MB of audio without complaint. On an iPhone it did not: `/marimba/` stalled
 * at 3 of 10 and `/dulcimer/` at 3 of 9, both at the point where cumulative
 * decoded audio crossed 4MB, while `/piano/` at 3.7MB total and `/kit/` at 2.5MB
 * completed. Four observations, one threshold.
 *
 * `sync()` is a round trip, so it cannot return until everything queued ahead of
 * it has been processed. That is precisely "the channel has drained".
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
  timeoutMs = 20_000,
}: LoadSampleSetOptions): Promise<LoadedSample[]> {
  const loaded: LoadedSample[] = []
  const total = names.length
  let decodedBytes = 0

  for (const name of names) {
    onProgress?.({ done: loaded.length, total, loading: name, decodedBytes })

    const bufnum = session.buffers.alloc()
    // encodeURIComponent, not raw: a filename with a space or a # would
    // otherwise truncate at the fragment and 404 on the rest.
    let result
    try {
      result = await withTimeout(
        session.sonic.loadSample(bufnum, `${base}${encodeURIComponent(name)}`),
        timeoutMs,
        // The number is the diagnosis. Every page that stays under about 3.7MB
        // of decoded audio loads on an iPhone; the two that went past 4MB
        // stalled at the sample that crossed it.
        `no answer after ${(timeoutMs / 1000).toFixed(0)}s with ` +
          `${(decodedBytes / 1048576).toFixed(2)}MB of decoded audio already accepted`,
      )
    } catch (cause) {
      // Named, because the generic message says only that a load failed. Which
      // file it was is the whole diagnosis: a 404 is a store that was not
      // pushed, a decode error is a format the browser will not take, and a
      // failure partway through a set that started fine is memory.
      throw new Error(`${name} (${loaded.length} of ${total} loaded): ${message(cause)}`, {
        cause,
      })
    }

    // Before the next load, not after the last: the point is to leave the
    // channel empty for whatever is queued next, and after the final one there
    // is nothing waiting.
    //
    // Kept after measuring that it costs nothing, and dropped as *the* fix for
    // the stall — it did not help. The channel draining is necessary and not
    // sufficient.
    await session.sonic.sync()

    // At the AudioContext's rate, not the file's: decodeAudioData resamples, so
    // a 44.1kHz file costs 8.8% more than its own duration suggests.
    decodedBytes += (result.numFrames ?? 0) * (result.numChannels ?? 0) * 4

    loaded.push({
      name,
      bufnum,
      numFrames: result.numFrames ?? 0,
      numChannels: result.numChannels ?? 0,
      sampleRate: result.sampleRate ?? 0,
    })
  }

  onProgress?.({ done: total, total, loading: null, decodedBytes })
  return loaded
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/**
 * Reject if a promise has not settled in time.
 *
 * The timer is cleared either way, so a load that finishes just after the
 * deadline does not leave a pending timeout holding the page awake.
 */
function withTimeout<T>(work: Promise<T>, ms: number, detail: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(detail)), ms)
  })
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer)) as Promise<T>
}
