export { seq, type ScheduledEvent } from '@ss/engine'

/**
 * `Pxrand` — like `Prand`, but never the same value twice running.
 *
 * With a two-element list that makes it a strict alternation with a random
 * start, which is what `Pxrand([-0.5, 0.5])` is doing in the original: the
 * drum lands left and right in turn rather than clustering.
 */
export function xrandOf<T>(values: readonly T[]): () => T {
  let last = -1
  return () => {
    let at = Math.floor(Math.random() * values.length)
    if (values.length > 1) while (at === last) at = Math.floor(Math.random() * values.length)
    last = at
    return values[at] as T
  }
}
