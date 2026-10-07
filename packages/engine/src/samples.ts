import type { Session } from './session.ts'

export interface LoadedSample {
  /** Filename as given, which is how the page refers to it. */
  name: string
  bufnum: number
  numFrames: number
  numChannels: number
  sampleRate: number
}

export interface LoadSampleSetOptions {
  session: Session
  /** Filenames in the shared store, without a path. */
  names: readonly string[]
  /** Where the store is served. */
  base?: string
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
}: LoadSampleSetOptions): Promise<LoadedSample[]> {
  const loaded: LoadedSample[] = []

  for (const name of names) {
    const bufnum = session.buffers.alloc()
    // encodeURIComponent, not raw: a filename with a space or a # would
    // otherwise truncate at the fragment and 404 on the rest.
    const result = await session.sonic.loadSample(bufnum, `${base}${encodeURIComponent(name)}`)

    loaded.push({
      name,
      bufnum,
      numFrames: result.numFrames ?? 0,
      numChannels: result.numChannels ?? 0,
      sampleRate: result.sampleRate ?? 0,
    })
  }

  return loaded
}
