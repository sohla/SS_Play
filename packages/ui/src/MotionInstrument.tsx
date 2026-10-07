import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ClientConductor,
  Conductor,
  HeldVoice,
  type ClientConductorOptions,
  type ConductorOptions,
  type HeldVoiceOptions,
} from '@ss/engine'
import { useSuperSonic } from '@ss/react'
import { RESTING, requestMotion, watchMotion, type Motion } from '@ss/motion'
import { BootGate } from './BootGate.tsx'
import { EngineFooter } from './EngineFooter.tsx'
import { PageHeader } from './PageHeader.tsx'

/** One trace of AirKit's `~plot`: a value the mapping reads, and what it does. */
export interface Trace {
  label: string
  hint: string
  /** -1..1. */
  value: number
}

export interface Mapped {
  /** Seconds between events. */
  dur: number
  /** The clock stops below its own threshold. */
  level: number
  /** Controls merged into every voice as it is born. */
  voice: Record<string, number>
  /** Extra controls on the clock itself, beyond dur and level. */
  clock?: Record<string, number>
  /** Controls for a held voice, when a page has one alongside a sequence. */
  held?: Record<string, number>
  /** What `~plot` would draw. */
  traces: Trace[]
  /** Calculated values worth reading, in order. */
  values: [name: string, text: string][]
}

/**
 * The three shapes a personality takes.
 *
 * `conductor` runs the pattern as a Demand graph in the server and spawns a
 * voice per event it reports. `client` runs the pattern in JavaScript and
 * schedules each event ahead with an OSC timetag — slower to reason about,
 * but the only option when the pattern's shape changes while it plays.
 * `held` opens one voice and plays it by moving its controls, which is why
 * those personalities have no pattern at all.
 *
 * A page may use more than one: a sequence over a drone is two.
 */
export type Instrument =
  | ({ kind: 'conductor' } & Omit<ConductorOptions, 'session'>)
  | ({ kind: 'client' } & Omit<ClientConductorOptions, 'session'>)
  | ({ kind: 'held' } & Omit<HeldVoiceOptions, 'session'>)

export interface MotionInstrumentProps {
  title: string
  blurb: ReactNode
  instrument: Instrument | Instrument[]
  /** The ported `~next`. Called at send rate and again, separately, for display. */
  map(motion: Motion): Mapped
  /** Matches the comparison inside the clock SynthDef. */
  silenceBelow: number
  /**
   * Hold the build until the page's own setup is done.
   *
   * A sampled instrument cannot be constructed until its buffers are loaded, and
   * loading needs a booted engine — so the page boots, loads, and only then has
   * an instrument to hand over. Defaults to true for every page that needs no
   * setup at all.
   */
  ready?: boolean
  /** Shown while booted and not yet ready. */
  pending?: ReactNode
  /**
   * Set when the wait has failed, so the panel stops pretending to be busy.
   *
   * Separate from `pending` rather than folded into it: moving stripes behind an
   * error message says the page is still working on it, which is the one thing
   * an error must not say.
   */
  pendingFailed?: boolean
}

/** Control updates per second. The events are spawned by the clock, not by this. */
const SEND_HZ = 30

/**
 * A page whose instrument is the phone's movement driving a sequence.
 *
 * Shared because four ported personalities differ only in their mapping and
 * their SynthDefs — everything around that is identical, and writing it four
 * times is how four pages come to disagree about what "stopped" means.
 *
 * The rate discipline is the part worth not rewriting: two sensor events at
 * ~60Hz each go to a ref, OSC leaves on a 30Hz timer, and React sees the
 * reading at 10Hz. Nothing here calls setState from a sensor handler.
 */
export function MotionInstrument({
  title,
  blurb,
  instrument,
  map,
  silenceBelow,
  ready = true,
  pending,
  pendingFailed = false,
}: MotionInstrumentProps) {
  const { status, boot, probe, session } = useSuperSonic()
  const [motion, setMotion] = useState<Motion>(RESTING)
  const [mapped, setMapped] = useState<Mapped>(() => map(RESTING))
  const [spawned, setSpawned] = useState(0)
  const [denied, setDenied] = useState(false)

  const live = useRef<(Conductor | ClientConductor | HeldVoice)[]>([])
  const latest = useRef<Motion>(RESTING)

  const booted = status.phase === 'ready' || status.phase === 'degraded'

  useEffect(() => {
    const engine = session()
    // length, not truthiness: an empty array is truthy, so the obvious guard
    // silently builds nothing and the page renders perfectly in silence.
    if (!booted || !ready || !engine || live.current.length > 0) return

    const built = (Array.isArray(instrument) ? instrument : [instrument]).map((spec) => {
      if (spec.kind === 'conductor') return new Conductor({ session: engine, ...spec })
      // Not started here. A client conductor begins scheduling the moment it
      // is told to, and nothing has played it yet — starting on construction
      // spills a second of notes before the first reading arrives, which is
      // the same mistake as a clock whose level defaults to mid-travel.
      if (spec.kind === 'client') return new ClientConductor({ session: engine, ...spec })
      return new HeldVoice({ session: engine, ...spec })
    })

    live.current = built
    return () => {
      for (const one of built) one.dispose()
      live.current = []
    }
    // instrument is an object literal at the call site, so it is a new
    // reference every render; depending on it would tear the instrument down
    // and rebuild it on each one. `ready` is in the list because a sampled page
    // flips it once, after loading — without it the build never re-runs and the
    // page sits silent with every buffer in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, ready, session])

  useEffect(() => {
    if (!booted || denied) return
    return watchMotion({ onMotion: (next) => (latest.current = next) })
  }, [booted, denied])

  useEffect(() => {
    if (!booted) return

    const send = () => {
      // Nothing is sent until a sensor has actually reported. The resting pose
      // is a perfectly valid one, so without this a page plays on load and
      // never stops on a machine with nothing to tilt.
      if (live.current.length === 0 || !latest.current.live) return

      const next = map(latest.current)
      for (const one of live.current) {
        if (one instanceof Conductor) {
          one.setVoiceControls(next.voice)
          one.setClock({ dur: next.dur, level: next.level, ...next.clock })
        } else if (one instanceof HeldVoice) {
          // A held voice has no step and no events: everything the phone
          // decides goes straight onto the one synth, continuously.
          one.set(next.held ?? next.voice)
        }
        else if (one instanceof ClientConductor) {
          // A ClientConductor reads the controls itself, through the closure
          // the page gave it — it pulls events rather than being pushed values.
          // What it cannot know is whether it should be running at all: a
          // Demand clock gates its own trigger inside the graph, and this has
          // no graph. Left alone it schedules inaudible notes forever.
          const should = next.level >= silenceBelow
          if (should && !one.running) one.start()
          if (!should && one.running) one.stop()
        }
      }
    }

    const sending = setInterval(send, 1000 / SEND_HZ)
    const showing = setInterval(() => {
      setMotion(latest.current)
      setMapped(map(latest.current))
      setSpawned(
        live.current.reduce(
          (total, one) =>
            total + (one instanceof Conductor || one instanceof ClientConductor ? one.spawned : 0),
          0,
        ),
      )
    }, 100)

    return () => {
      clearInterval(sending)
      clearInterval(showing)
    }
  }, [booted, map, silenceBelow])

  const start = useCallback(async () => {
    // Both from the same tap: iOS needs requestPermission reached from a
    // gesture, and an AudioContext needs one too.
    const permission = await requestMotion()
    if (permission === 'denied') setDenied(true)
    boot()
  }, [boot])

  const playing = mapped.level >= silenceBelow

  return (
    <main className="flex min-h-dvh flex-col bg-canvas text-neutral-200">
      <PageHeader title={title} />

      <div className="pad-safe-x mx-auto flex w-full max-w-md flex-1 flex-col gap-5 pt-6">
        <p className="text-sm text-neutral-500">{blurb}</p>

        <BootGate
          phase={status.phase}
          error={status.error}
          degradedReason={status.degradedReason}
          sabUnavailable={probe.sabUnavailable}
          onBoot={start}
        />

        {denied ? (
          <p className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
            Motion access was refused, so it will not respond. Safari remembers this per site:
            Settings → Safari → Motion &amp; Orientation Access, then reload.
          </p>
        ) : null}

        {booted && !motion.live && !denied ? (
          <p className="rounded border border-neutral-800 bg-surface p-3 text-sm text-neutral-500">
            Running, but no orientation events have arrived. This page needs a phone or a tablet
            &mdash; on a desktop browser there is nothing to tilt.
          </p>
        ) : null}

        {booted && !ready ? (
          <p
            data-testid="pending"
            data-failed={pendingFailed ? 'true' : undefined}
            className={
              pendingFailed
                ? 'rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300'
                : 'ss-waiting rounded border border-neutral-800 bg-surface p-3 text-sm text-neutral-400'
            }
          >
            {pending ?? 'Loading…'}
          </p>
        ) : null}

        {booted && ready ? (
          <>
            <div
              data-testid="playing"
              className={`rounded border p-3 font-mono text-xs ${
                playing
                  ? 'border-sky-900 bg-sky-950/30 text-sky-300'
                  : 'border-neutral-800 bg-surface text-neutral-600'
              }`}
            >
              {playing
                ? spawned > 0
                  ? `${spawned} events`
                  : 'sounding'
                : 'stopped — move to start'}
            </div>

            {mapped.traces.map((trace) => (
              <Trace key={trace.label} {...trace} />
            ))}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] text-neutral-600">
              {mapped.values.map(([name, text]) => (
                <div key={name} className="flex justify-between border-b border-neutral-900 py-0.5">
                  <dt>{name}</dt>
                  <dd className="text-neutral-400" data-testid={`value-${name}`}>
                    {text}
                  </dd>
                </div>
              ))}
              {spawned > 0 ? (
                <div className="flex justify-between border-b border-neutral-900 py-0.5">
                  <dt>events</dt>
                  <dd className="text-neutral-400" data-testid="value-events">
                    {spawned}
                  </dd>
                </div>
              ) : null}
            </dl>
          </>
        ) : null}

        <div className="mt-auto" />
      </div>

      {booted ? <EngineFooter /> : null}
    </main>
  )
}

/**
 * One of AirKit's `~plot` traces.
 *
 * These are shown in preference to roll/pitch/yaw because they are the numbers
 * the curves are actually fed — a gesture that does nothing is visible here and
 * invisible in the raw angles.
 */
function Trace({ label, hint, value }: Trace) {
  const position = (Math.min(1, Math.max(-1, value)) + 1) / 2

  return (
    <div data-testid={`axis-${label}`}>
      <div className="flex items-baseline justify-between font-mono text-xs">
        <span className="text-neutral-300">{label}</span>
        <span className="text-neutral-600">{hint}</span>
      </div>
      <div className="relative mt-1 h-2 rounded bg-neutral-800">
        <div className="absolute inset-y-0 left-1/2 w-px bg-neutral-700" />
        <div
          className="absolute inset-y-0 w-2 rounded bg-sky-400"
          style={{ left: `calc(${(position * 100).toFixed(1)}% - 4px)` }}
        />
      </div>
    </div>
  )
}
