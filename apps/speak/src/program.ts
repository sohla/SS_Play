/**
 * What the narrator says, and when, within every minute of wall-clock time.
 *
 * Anchored to the minute rather than to page load, as `/sync/` anchors its grid
 * to the epoch: two devices on one program speak the same cue in the same
 * second, and a composer can write "at :15" and mean it.
 *
 * The browser's voice cannot be placed precisely — it starts when the OS gets
 * round to it — so cues are whole seconds and the page reports how late each
 * one actually began. A spoken line breathes anyway; a second either way is
 * inside that.
 */

export type Cue =
  | { at: number; kind: 'count'; n: number }
  | { at: number; kind: 'lines'; block: 'welcome' | 'instruction' }

/** Seconds into the minute. Counts 1–10 at :00–:09, then two blocks of narration. */
export const PROGRAM: readonly Cue[] = [
  ...Array.from({ length: 10 }, (_, n) => ({ at: n, kind: 'count' as const, n: n + 1 })),
  { at: 15, kind: 'lines', block: 'welcome' },
  { at: 40, kind: 'lines', block: 'instruction' },
]

/** The minute's spans, for drawing: when each part starts and roughly ends. */
export const SPANS = [
  { from: 0, to: 10, label: 'count' },
  { from: 15, to: 32, label: 'welcome' },
  { from: 40, to: 48, label: 'instruction' },
] as const

/** Which second of the minute a wall-clock instant falls in, 0..59. */
export function secondOf(wallMs: number): number {
  return Math.floor(wallMs / 1000) % 60
}

/** The absolute minute an instant falls in, so a cue fires once per minute. */
export function minuteOf(wallMs: number): number {
  return Math.floor(wallMs / 60_000)
}

/** The wall-clock instant a cue is due in a given minute. */
export function dueAt(minute: number, cue: Cue): number {
  return minute * 60_000 + cue.at * 1000
}

/**
 * Cues that have come due since `since` and up to `now`, each with the instant
 * it was meant for.
 *
 * Between two scheduler ticks, never more than one tick's worth: a tab that
 * comes back from the background does not get a minute of backlog read out at
 * once, only what fell due in the last `stale` ms.
 */
export function dueBetween(
  since: number,
  now: number,
  stale = 1500,
): { cue: Cue; due: number }[] {
  const from = Math.max(since, now - stale)
  const found: { cue: Cue; due: number }[] = []
  for (let minute = minuteOf(from); minute <= minuteOf(now); minute++) {
    for (const cue of PROGRAM) {
      const due = dueAt(minute, cue)
      if (due > from && due <= now) found.push({ cue, due })
    }
  }
  return found
}
