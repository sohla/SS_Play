import { useCallback, useEffect, useMemo, useRef } from 'react'
import { ctl, i } from '@ss/engine'
import { useSampleSet, useSession } from '@ss/react'
import { MotionInstrument, type Mapped } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { DIVS, SILENCE_BELOW, dulcimerFrom, type Dulcimer } from './mapping.ts'
import { arrangeDulcimer, dulcimerPattern, type DulcimerState } from './pattern.ts'

/**
 * Nine samples, named by the MIDI note each was recorded at.
 *
 * The original scans twenty-six. These are the nine the lookup can ever select —
 * see the note in pattern.ts — each trimmed to three seconds, which is just past
 * the longest the envelope can hold one open. 27 seconds in total, about 36MB of
 * memory, against 322 seconds and ~433MB for the folder as it stands.
 */
const LIBRARY = [26, 30, 36, 38, 42, 48, 50, 54, 60].map((midi) => `dulc_${midi}.flac`)

const RESTING: Dulcimer = { divIdx: 0, amp: 0 }

export function App() {
  const session = useSession()
  const { samples, progress, error } = useSampleSet(LIBRARY)

  const now = useRef<Dulcimer>(RESTING)
  const state = useRef<DulcimerState>({ last: { midi: 0, shift: 0, sample: 0 } })


  const library = useMemo(() => (samples ? arrangeDulcimer(samples) : null), [samples])

  /**
   * The fx tail, which the Instrument union has no shape for — so the page owns
   * it rather than the shell.
   *
   * Voices play into a private bus and this reads that bus and writes to the
   * output. The ordering is the mechanism: the conductor's group is created at
   * the *head* of the root group, so a synth added at the root's *tail* executes
   * after every voice in it, however many are sounding. That is the same
   * guarantee the original gets from Synth.tail into the voice group.
   *
   * Gated rather than freed outright, because a hard free on an fx tail cuts
   * whatever it is holding off mid-air.
   */
  useEffect(() => {
    if (!session || !library) return

    const node = session.sonic.nextNodeId()
    session.sonic.send(
      '/s_new',
      'ssp_dulcimer_fx',
      i(node),
      // addToTail of the root group.
      i(1),
      i(0),
      ...ctl({ in: session.firstPrivateBus, out: 0 }),
    )

    return () => {
      try {
        session.sonic.send('/n_set', node, 'gate', i(0))
      } catch {
        // The ordinary case on unload: the engine is already gone.
      }
    }
  }, [session, library])

  const nextEvent = useMemo(
    () =>
      library && session
        ? dulcimerPattern(library, () => now.current, state.current, session.firstPrivateBus)
        : () => null,
    [library, session],
  )

  const map = useCallback((motion: Motion): Mapped => {
    const next = dulcimerFrom(motion)
    now.current = next
    const last = state.current.last

    return {
      dur: 0,
      level: next.amp,
      voice: {},
      traces: [
        { label: 'move', hint: 'subdivision, and level', value: motion.shake * 2 - 1 },
      ],
      values: [
        ['bar', `${DIVS[next.divIdx]} steps`],
        ['notes', `${DIVS[next.divIdx]} of 6`],
        ['note', `${last.midi}`],
        ['shift', `${last.shift > 0 ? '+' : ''}${last.shift}`],
      ],
    }
  }, [])

  return (
    <MotionInstrument
      title="dulcimer"
      blurb={
        <>
          A hammered string, struck in a figure that walks down three octaves. Moving the phone
          divides the bar into two, four or six &mdash; and a finer bar reaches further down the
          note pool, so it plays more notes rather than the same ones faster. Everything happens in
          the first tenth of the gesture; past that it barely changes.
        </>
      }
      instrument={useMemo(() => ({ kind: 'client' as const, nextEvent }), [nextEvent])}
      map={map}
      silenceBelow={SILENCE_BELOW}
      ready={library !== null}
      pending={
        error
          ? `Could not load ${error}`
          : `Loading 9 dulcimer samples — about 36MB. ${progress.done} of ${progress.total}.`
      }
      pendingFailed={error !== null}
    />
  )
}
