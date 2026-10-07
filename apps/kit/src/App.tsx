import { useCallback, useMemo, useRef } from 'react'
import { useSampleSet } from '@ss/react'
import { MotionInstrument, type Mapped } from '@ss/ui'
import type { Motion } from '@ss/motion'
import { DIVS, SILENCE_BELOW, kitFrom, type Kit } from './mapping.ts'
import { arrangeKit, kitPattern } from './pattern.ts'

/**
 * The kit, in the shared sample store.
 *
 * Named rather than discovered. The original scanned a folder, which is fine on
 * a machine that owns the folder — here the store is shared between pages, so a
 * page that took everything in it would change what it plays whenever something
 * unrelated was pushed.
 *
 * Trimmed on the way in: four of these were six to ten second ride tails, which
 * is most of the kit's memory for the part nobody hears under a drum pattern.
 * 13.5 seconds in total, mono, which is about 9MB of browser memory.
 */
const KIT = [
  'kit_bdrum_yamaha.flac',
  'kit_ride_16b.flac',
  'kit_ride_c1.flac',
  'kit_ride_16_2.flac',
  'kit_ride_16_3.flac',
  'kit_ride_47a.flac',
  'kit_ride_47b.flac',
  'kit_slap_1.flac',
  'kit_slap_2.flac',
  'kit_slap_3.flac',
  'kit_swis_1.flac',
  'kit_swis_4.flac',
]

const RESTING_KIT: Kit = { divIdx: 0, palette: 1, energy: 0, roll: 1, cutoff: 50 }

export function App() {
  const { samples, progress, error } = useSampleSet(KIT)

  const now = useRef<Kit>(RESTING_KIT)


  const kit = useMemo(() => (samples ? arrangeKit(samples) : null), [samples])

  const nextEvent = useMemo(
    () => (kit ? kitPattern(kit, () => now.current) : () => null),
    [kit],
  )

  const map = useCallback(
    (motion: Motion): Mapped => {
      const buffers = kit?.buffers.length ?? 1
      const next = kitFrom(motion, buffers)
      now.current = next

      return {
        dur: 0,
        level: next.energy,
        voice: {},
        traces: [
          { label: 'move', hint: 'subdivision, palette, level', value: motion.shake * 2 - 1 },
          { label: 'roll', hint: 'rate', value: motion.roll },
          { label: 'turn', hint: 'high-pass', value: motion.yaw * 2 - 1 },
        ],
        values: [
          ['bar', `${DIVS[next.divIdx]} steps`],
          ['palette', `${next.palette} of ${buffers}`],
          ['level', next.energy.toFixed(3)],
          ['high-pass', `${next.cutoff.toFixed(0)}Hz`],
        ],
      }
    },
    [kit],
  )

  return (
    <MotionInstrument
      title="kit"
      blurb={
        <>
          A half-second bar cut into two, four or eight. Moving the phone changes how finely it is
          divided rather than how fast it runs, and widens the set of drums the off-beats can
          reach. The downbeat is always the kick. Roll for playback rate, turn for the high-pass.
        </>
      }
      instrument={useMemo(() => ({ kind: 'client' as const, nextEvent }), [nextEvent])}
      map={map}
      silenceBelow={SILENCE_BELOW}
      ready={kit !== null}
      pending={
        error
          ? `Could not load ${error}`
          : `Loading 12 drums — ${progress.done} of ${progress.total}, `
            + `${(progress.decodedBytes / 1048576).toFixed(2)}MB decoded.`
      }
      pendingFailed={error !== null}
    />
  )
}
