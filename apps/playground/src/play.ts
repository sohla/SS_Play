import { ctl, i, type Session } from '@ss/engine'

export interface PlayOptions {
  name: string
  values: Record<string, number>
  /** Whether the def declares a gate, read from its compiled parameters. */
  gated: boolean
  durationS?: number
}

/**
 * Fire one note and resolve when scsynth reports the node freed.
 *
 * Waits on `/n_end` rather than a timer. The node frees itself through its
 * envelope's doneAction, and sleeping instead is the main source of flakiness
 * in anything that drives audio.
 */
export async function playNote(session: Session, options: PlayOptions): Promise<void> {
  const { name, values, gated, durationS = 1 } = options
  const nodeId = session.sonic.nextNodeId()

  const ended = session.dispatcher.waitForNodeEnd(nodeId, {
    timeoutMs: (durationS + 5) * 1000,
  })

  session.sonic.send('/s_new', name, nodeId, 0, 0, ...ctl(values))

  if (gated) {
    // A gated def sustains until released. Without this the node never frees
    // and maxNodes fills up, which presents as later notes silently not playing.
    setTimeout(() => {
      try {
        session.sonic.send('/n_set', nodeId, 'gate', i(0))
      } catch {
        // The engine may have been disposed while the note was sounding.
      }
    }, durationS * 1000)
  }

  await ended
}
