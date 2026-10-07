import { useCallback, useMemo, useRef } from 'react'
import { useSampleSet } from '@ss/react'
import { MotionInstrument, type Mapped } from '@ss/ui'
import type { Motion } from '@ss/motion'
import {
  BASS_DIVS,
  DEGREES,
  KIT_DIVS,
  MELODY_DIVS,
  PLOT_LABELS,
  ROOTS,
  SILENCE_BELOW,
  comboFrom,
  plotOf,
  type Combo,
} from './mapping.ts'
import {
  arrangeKit,
  arrangePiano,
  bassPattern,
  freshShared,
  kitPattern,
  melodyPattern,
  rootOf,
} from './pattern.ts'

/**
 * Six drums and three piano octaves.
 *
 * Deliberately not the full kit or the full piano library: together those are
 * 6.15MB of decoded audio and an iPhone stalls a load past about 4MB. This is
 * 2.27MB — the six shortest, most percussive drums, and three octaves rather than
 * six, which the nearest-sample lookup covers within six semitones.
 */
const KIT = [
  'kit_bdrum_yamaha.flac',
  'kit_slap_1.flac',
  'kit_slap_2.flac',
  'kit_slap_3.flac',
  'kit_swis_1.flac',
  'kit_swis_4.flac',
]
const PIANO = ['piano_C3.flac', 'piano_C4.flac', 'piano_C5.flac']
const LIBRARY = [...KIT, ...PIANO]

const RESTING: Combo = {
  kitDiv: 0,
  bassDiv: 0,
  melodyDiv: 0,
  pool: 3,
  level: 0,
  filterFreq: 180,
  bright: 1200,
  wantsRootShift: false,
}

export function App() {
  const { samples, progress, error } = useSampleSet(LIBRARY)

  const now = useRef<Combo>(RESTING)
  const shared = useRef(freshShared())
  const melody = useRef({ last: { midi: 0, shift: 0 } })

  const parts = useMemo(() => {
    if (!samples) return null
    const drums = samples.filter((s) => s.name.startsWith('kit_'))
    const tones = samples.filter((s) => s.name.startsWith('piano_'))
    return { kit: arrangeKit(drums), piano: arrangePiano(tones) }
  }, [samples])

  // Three conductors, one bar. MotionInstrument starts and stops every `client`
  // instrument on the same level test, so they begin together — which is what
  // keeps three independent schedulers in phase. Their steps all divide 2s, so
  // nothing drifts after that.
  const instrument = useMemo(
    () =>
      parts
        ? ([
            {
              kind: 'client' as const,
              nextEvent: kitPattern(parts.kit, () => now.current, shared.current),
            },
            { kind: 'client' as const, nextEvent: bassPattern(() => now.current, shared.current) },
            {
              kind: 'client' as const,
              nextEvent: melodyPattern(
                parts.piano,
                () => now.current,
                shared.current,
                melody.current,
              ),
            },
          ])
        : { kind: 'client' as const, nextEvent: () => null },
    [parts],
  )

  const map = useCallback((motion: Motion, sensitivity: number): Mapped => {
    const next = comboFrom(motion, sensitivity)
    now.current = next
    const root = rootOf(shared.current)

    return {
      dur: 0,
      level: next.level,
      voice: {},
      traces: [],
      values: [
        ['root', `${['i', 'iv', 'VI', 'III'][ROOTS.indexOf(root as never)] ?? '?'} (+${root})`],
        ['pool', `${next.pool} of ${DEGREES.length}`],
        ['kit', `${KIT_DIVS[next.kitDiv]} / bar`],
        ['bass', `${BASS_DIVS[next.bassDiv]} / bar`],
        ['melody', `${MELODY_DIVS[next.melodyDiv]} / bar`],
        ['filter', `${next.filterFreq.toFixed(0)}Hz`],
        ['note', `${melody.current.last.midi}`],
        ['shift', `${melody.current.last.shift > 0 ? '+' : ''}${melody.current.last.shift}`],
      ],
    }
  }, [])

  return (
    <MotionInstrument
      title="combo"
      blurb={
        <>
          Three layers on one two-second bar &mdash; a kit, a moog bass on the root and fifth, and a
          piano line. <strong>Turn</strong> the phone to widen the pitch set and open the bass
          filter: smooth, and you can sit anywhere in it. <strong>Shake</strong> it to step the
          rhythm between subdivisions, and flick it hard to move the root &mdash; once a bar at most,
          and always on the beat.
        </>
      }
      instrument={instrument}
      map={map}
      silenceBelow={SILENCE_BELOW}
      plot={plotOf}
      plotLabels={PLOT_LABELS}
      ready={parts !== null}
      pending={
        error
          ? `Could not load ${error}`
          : `Loading 6 drums and 3 piano octaves — ${progress.done} of ${progress.total}, ` +
            `${(progress.decodedBytes / 1048576).toFixed(2)}MB decoded.`
      }
    />
  )
}
