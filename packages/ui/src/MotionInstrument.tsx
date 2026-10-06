import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Conductor, type ConductorOptions } from '@ss/engine'
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
  /** What `~plot` would draw. */
  traces: Trace[]
  /** Calculated values worth reading, in order. */
  values: [name: string, text: string][]
}

export interface MotionInstrumentProps {
  title: string
  blurb: ReactNode
  /** Everything the conductor needs except the session, which comes from context. */
  conductor: Omit<ConductorOptions, 'session'>
  /** The ported `~next`. Called at send rate and again, separately, for display. */
  map(motion: Motion): Mapped
  /** Matches the comparison inside the clock SynthDef. */
  silenceBelow: number
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
  conductor,
  map,
  silenceBelow,
}: MotionInstrumentProps) {
  const { status, boot, probe, session } = useSuperSonic()
  const [motion, setMotion] = useState<Motion>(RESTING)
  const [mapped, setMapped] = useState<Mapped>(() => map(RESTING))
  const [spawned, setSpawned] = useState(0)
  const [denied, setDenied] = useState(false)

  const live = useRef<Conductor | null>(null)
  const latest = useRef<Motion>(RESTING)

  const booted = status.phase === 'ready' || status.phase === 'degraded'

  useEffect(() => {
    const engine = session()
    if (!booted || !engine || live.current) return

    const built = new Conductor({ session: engine, ...conductor })
    live.current = built
    return () => {
      built.dispose()
      live.current = null
    }
    // conductor is an object literal at the call site, so it is a new reference
    // every render; depending on it would tear the instrument down and rebuild
    // it on each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, session])

  useEffect(() => {
    if (!booted || denied) return
    return watchMotion({ onMotion: (next) => (latest.current = next) })
  }, [booted, denied])

  useEffect(() => {
    if (!booted) return

    const send = () => {
      const built = live.current
      // Nothing is sent until a sensor has actually reported. The resting pose
      // is a perfectly valid one, so without this a page plays on load and
      // never stops on a machine with nothing to tilt.
      if (!built || !latest.current.live) return

      const next = map(latest.current)
      built.setVoiceControls(next.voice)
      built.setClock({ dur: next.dur, level: next.level })
    }

    const sending = setInterval(send, 1000 / SEND_HZ)
    const showing = setInterval(() => {
      setMotion(latest.current)
      setMapped(map(latest.current))
      setSpawned(live.current?.spawned ?? 0)
    }, 100)

    return () => {
      clearInterval(sending)
      clearInterval(showing)
    }
  }, [booted, map])

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

        {booted ? (
          <>
            <div
              data-testid="playing"
              className={`rounded border p-3 font-mono text-xs ${
                playing
                  ? 'border-sky-900 bg-sky-950/30 text-sky-300'
                  : 'border-neutral-800 bg-surface text-neutral-600'
              }`}
            >
              {playing ? `${spawned} events` : 'stopped — move to start'}
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
              <div className="flex justify-between border-b border-neutral-900 py-0.5">
                <dt>events</dt>
                <dd className="text-neutral-400" data-testid="value-events">
                  {spawned}
                </dd>
              </div>
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
