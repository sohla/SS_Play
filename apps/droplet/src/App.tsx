import { useCallback, useEffect, useRef, useState } from 'react'
import { ctl } from '@ss/engine'
import { useSuperSonic } from '@ss/react'
import { BootGate, EngineFooter, PageHeader } from '@ss/ui'
import { RESTING, requestMotion, watchMotion, type Motion } from '../../imu/src/sensors.ts'
import {
  plotFrom,
  showerFrom,
  SILENCE_BELOW,
  type Plot,
  type Shower as ShowerValues,
} from './mapping.ts'
import { Shower } from './shower.ts'

/** Control updates per second. The drops are spawned by the clock, not by this. */
const SEND_HZ = 30

export function App() {
  const { status, boot, probe, session } = useSuperSonic()
  const [motion, setMotion] = useState<Motion>(RESTING)
  const [values, setValues] = useState<ShowerValues>(() => showerFrom(RESTING))
  const [plot, setPlot] = useState<Plot>(() => plotFrom(RESTING))
  const [drops, setDrops] = useState(0)
  const [denied, setDenied] = useState(false)

  const shower = useRef<Shower | null>(null)
  const latest = useRef<Motion>(RESTING)
  const counted = useRef(0)

  const booted = status.phase === 'ready' || status.phase === 'degraded'

  // The whole instrument: a group of drops, a reverb behind them, and the clock
  // that decides when a drop happens.
  useEffect(() => {
    const live = session()
    if (!booted || !live || shower.current) return

    const built = new Shower(live, showerFrom(RESTING))
    shower.current = built

    // Each event the clock emits becomes a real synth. This is the whole point
    // of the arrangement: the sequence is decided in the server, where the
    // audio clock keeps it exact, and the voices are ordinary nodes that free
    // themselves — which is the polyphony a Demand graph cannot give.
    const release = live.dispatcher.on('/ssp_drop', (message) => {
      // SendReply sends [address, nodeId, replyId, ...values].
      const [freq, filterFreq, filterRQ, pan] = message.slice(3) as number[]
      if (freq === undefined) return

      built.spawn({
        freq,
        filterFreq: filterFreq ?? 3000,
        filterRQ: filterRQ ?? 1,
        pan: pan ?? 0,
      })
      counted.current += 1
    })

    return () => {
      release()
      built.dispose()
      shower.current = null
    }
  }, [booted, session])

  useEffect(() => {
    if (!booted || denied) return
    return watchMotion({ onMotion: (next) => (latest.current = next) })
  }, [booted, denied])

  useEffect(() => {
    if (!booted) return
    const live = session()
    if (!live) return

    const send = () => {
      const built = shower.current
      if (!built || built.clock === null) return

      // Nothing is sent until an orientation event has actually arrived. The
      // resting pose is a level phone, which plays hard — so without this the
      // page starts playing on load and never stops on a machine that has no
      // sensor to say otherwise.
      if (!latest.current.live) return

      const next = showerFrom(latest.current)
      built.setControls(next)
      built.setVerbRoom(next.room)
      // dur and level are already in the def's own units — the mapping ported
      // the curves, so there is nothing left for mapSpec to do.
      live.sonic.send('/n_set', built.clock, ...ctl({ dur: next.dur, level: next.level }))
    }

    const sending = setInterval(send, 1000 / SEND_HZ)
    const showing = setInterval(() => {
      setMotion(latest.current)
      setPlot(plotFrom(latest.current))
      setValues(showerFrom(latest.current))
      setDrops(counted.current)
    }, 100)

    return () => {
      clearInterval(sending)
      clearInterval(showing)
    }
  }, [booted, session])

  const start = useCallback(async () => {
    const permission = await requestMotion()
    if (permission === 'denied') setDenied(true)
    boot()
  }, [boot])

  const playing = values.level >= SILENCE_BELOW

  return (
    <main className="flex min-h-dvh flex-col bg-canvas text-neutral-200">
      <PageHeader title="droplet" />

      <div className="pad-safe-x mx-auto flex w-full max-w-md flex-1 flex-col gap-5 pt-6">
        <p className="text-sm text-neutral-500">
          Synth droplets, from AirKit&rsquo;s{' '}
          <code className="text-neutral-400">droplet</code> personality. Hold the phone flat to
          play, stand it upright to stop. Flick it to lengthen the tails; roll it to colour them.
        </p>

        <BootGate
          phase={status.phase}
          error={status.error}
          degradedReason={status.degradedReason}
          sabUnavailable={probe.sabUnavailable}
          onBoot={start}
        />

        {denied ? (
          <p className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
            Motion access was refused, so the droplets will not respond. Safari remembers this per site:
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
              {playing ? `${drops} droplets` : 'stopped — lay the phone flat to start'}
            </div>

            {/* What AirKit's ~plot draws: the three numbers the curves are
                actually fed, rather than the orientation they came from. A
                gesture that does nothing shows up here and is invisible in
                roll/pitch/yaw. */}
            <Readout id="gyroY" label="gyroY" hint="rate, level" value={plot.gyroY} />
            <Readout id="gyroX" label="gyroX" hint="wobble ceiling" value={plot.gyroX} />
            <Readout id="side" label="side" hint="tail, wobble travel" value={plot.side * 2 - 1} />

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] text-neutral-600">
              <Value name="dur" value={`${values.dur.toFixed(3)}s`} />
              <Value name="level" value={values.level.toFixed(3)} />
              <Value name="decay" value={`${values.decay.toFixed(2)}s`} />
              <Value name="wobble" value={`${values.wobble.toFixed(0)}Hz`} />
              <Value name="room" value={values.room.toFixed(3)} />
              <Value name="drops" value={String(drops)} />
            </dl>
          </>
        ) : null}

        <div className="mt-auto" />
      </div>

      {booted ? <EngineFooter /> : null}
    </main>
  )
}

function Value({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-neutral-900 py-0.5">
      <dt>{name}</dt>
      <dd className="text-neutral-400" data-testid={`value-${name}`}>
        {value}
      </dd>
    </div>
  )
}

function Readout({
  id,
  label,
  hint,
  value,
}: {
  id: string
  label: string
  hint: string
  value: number
}) {
  const position = (Math.min(1, Math.max(-1, value)) + 1) / 2

  return (
    <div data-testid={`axis-${id}`}>
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
