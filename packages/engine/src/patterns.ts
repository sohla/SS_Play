/**
 * Just enough of SuperCollider's pattern library to run a personality.
 *
 * `Pbind` and friends live in sclang, which never crossed to WebAssembly. The
 * server-side answer is a Demand graph, and it is the right one when a pattern
 * is a fixed sequence. It stops being right when the pattern's *shape* changes
 * while it plays: `Pswitch(list, Pkey(\divIdx))` reads a live index and embeds
 * a whole sub-pattern before asking again, and three of those have to stay in
 * lockstep. In a Demand graph that is three independent streams hoping to
 * agree; here it is a function call.
 *
 * A stream is exhausted when it returns undefined, which is how a finite
 * pattern tells a switch it is time to choose again.
 */
export interface Stream<T> {
  next(): T | undefined
}

export type Pattern<T> = () => Stream<T>

/** `Pseq(values, repeats)`. */
export function seq<T>(values: readonly T[], repeats = 1): Pattern<T> {
  return () => {
    let index = 0
    return {
      next: () => (index >= values.length * repeats ? undefined : values[index++ % values.length]),
    }
  }
}

/** `Pn(value, repeats)` — one value, that many times, then done. */
export function pn<T>(value: T, repeats: number): Pattern<T> {
  return () => {
    let left = repeats
    return { next: () => (left-- > 0 ? value : undefined) }
  }
}

/** `Pseries(start, step, length)`. */
export function series(start: number, step: number, length: number): Pattern<number> {
  return () => {
    let index = 0
    return { next: () => (index >= length ? undefined : start + step * index++) }
  }
}

/** `Prand(values, repeats)`. Infinite by default, as the patterns that use it are. */
export function rand<T>(values: readonly T[], repeats = Infinity): Pattern<T> {
  return () => {
    let left = repeats
    return {
      next: () =>
        left-- > 0 ? values[Math.floor(Math.random() * values.length)] : undefined,
    }
  }
}

/** `Pwhite(lo, hi, repeats)`. */
export function white(lo: number, hi: number, repeats = Infinity): Pattern<number> {
  return () => {
    let left = repeats
    return { next: () => (left-- > 0 ? lo + Math.random() * (hi - lo) : undefined) }
  }
}

/** `Pwhite` over integers, which is what sclang gives for integer bounds. */
export function iwhite(lo: number, hi: number, repeats = Infinity): Pattern<number> {
  return () => {
    let left = repeats
    return {
      next: () => (left-- > 0 ? lo + Math.floor(Math.random() * (hi - lo + 1)) : undefined),
    }
  }
}

/** A value that never changes and never ends. */
export function hold<T>(value: T): Pattern<T> {
  return () => ({ next: () => value })
}

/**
 * `Pswitch(list, index)`.
 *
 * Embeds the selected pattern **whole** before reading the index again — which
 * is the difference between a bar and a note. Changing the index mid-pattern
 * takes effect at the next boundary, so a subdivision changes on the beat
 * rather than halfway through one.
 *
 * `Pswitch1` is the other one, and takes a single value from each; nothing here
 * needs it yet.
 */
export function switchOn<T>(patterns: readonly Pattern<T>[], index: () => number): Pattern<T> {
  return () => {
    let current: Stream<T> | null = null

    const choose = () => {
      const at = Math.min(Math.max(Math.round(index()), 0), patterns.length - 1)
      current = (patterns[at] as Pattern<T>)()
    }

    return {
      next: () => {
        if (!current) choose()
        let value = current?.next()
        if (value === undefined) {
          choose()
          value = current?.next()
        }
        return value
      },
    }
  }
}

/** Pull one value from each of several streams, as a Pbind does per event. */
export function bind<T extends Record<string, Stream<unknown>>>(
  streams: T,
): { [K in keyof T]: T[K] extends Stream<infer V> ? V | undefined : never } {
  const event = {} as Record<string, unknown>
  for (const [key, stream] of Object.entries(streams)) event[key] = stream.next()
  return event as never
}
