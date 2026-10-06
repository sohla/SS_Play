import { useCallback, useEffect, useRef, useState } from 'react'
import { ctl, mapSpec, type SynthDefContract } from '@ss/engine'
import { useSuperSonic } from '@ss/react'
import { BootGate, EngineFooter, PageHeader } from '@ss/ui'
import { unipolar } from './pose.ts'
import { RESTING, requestMotion, watchMotion, type Motion } from './sensors.ts'

const DEF = 'ssp_drone'

/**
 * Which movement drives which control.
 *
 * Every value arrives as 0..1 and goes through the SynthDef's own spec, so the
 * ranges and curves are the ones declared beside the UGen graph. A tilt does
 * not know what a cutoff is, and nothing here repeats a number from the def.
 */
const MAPPING = [
  { motion: 'roll', param: 'cutoff', gesture: 'tilt left / right', effect: 'brightness' },
  { motion: 'pitch', param: 'freq', gesture: 'tilt toward / away', effect: 'note' },
  { motion: 'yaw', param: 'detune', gesture: 'turn around', effect: 'detune' },
  { motion: 'yaw', param: 'spread', gesture: '', effect: 'stereo width' },
  { motion: 'shake', param: 'shimmer', gesture: 'shake', effect: 'drift' },
] as const

/** OSC updates per second. The sensors run at ~60Hz, which is more than a drone needs. */
const SEND_HZ = 30

export function App() {
  const { status, boot, probe, session } = useSuperSonic()
  const [contract, setContract] = useState<SynthDefContract | null>(null)
  const [motion, setMotion] = useState<Motion>(RESTING)
  const [denied, setDenied] = useState(false)

  const node = useRef<number | null>(null)
  const latest = useRef<Motion>(RESTING)

  const booted = status.phase === 'ready' || status.phase === 'degraded'

  useEffect(() => {
    fetch(`${__SS_ENGINE_BASE__}synthdefs/${DEF}.contract.json`)
      .then((response) => response.json())
      .then(setContract)
      .catch(() => setContract(null))
  }, [])

  // The drone starts when the engine does and runs until the page goes away.
  // There is no note to play: the instrument is always sounding and the phone
  // only ever changes it.
  useEffect(() => {
    const live = session()
    if (!booted || !live || node.current !== null) return

    const id = live.sonic.nextNodeId()
    node.current = id
    live.sonic.send('/s_new', DEF, id, 0, 0)

    return () => {
      // Gate off rather than /n_free, so the release stage runs and the drone
      // fades rather than stopping dead.
      try {
        live.sonic.send('/n_set', id, 'gate', { type: 'int', value: 0 })
      } catch {
        // The engine may already be gone, which is the ordinary case on unload.
      }
      node.current = null
    }
  }, [booted, session])

  // Sensor rate is ~60Hz per event and there are two of them. Nothing here
  // touches React state: the reading goes to a ref, OSC goes out on a timer,
  // and the display reads the ref at a rate a person can follow.
  useEffect(() => {
    if (!booted || denied) return
    return watchMotion({ onMotion: (next) => (latest.current = next) })
  }, [booted, denied])

  useEffect(() => {
    if (!booted || !contract) return
    const live = session()
    if (!live) return

    const specs = new Map(contract.specs.map((spec) => [spec.name, spec]))

    const send = () => {
      const id = node.current
      const now = latest.current
      if (id === null || !now.live) return

      const values: Record<string, number> = {}
      for (const { motion: source, param } of MAPPING) {
        const spec = specs.get(param)
        if (!spec) continue

        const unit =
          source === 'roll'
            ? unipolar(now.roll)
            : source === 'pitch'
              ? unipolar(now.pitch)
              : source === 'yaw'
                ? now.yaw
                : now.shake

        values[param] = mapSpec(spec, unit)
      }

      live.sonic.send('/n_set', id, ...ctl(values))
    }

    const sending = setInterval(send, 1000 / SEND_HZ)
    const showing = setInterval(() => setMotion(latest.current), 100)
    return () => {
      clearInterval(sending)
      clearInterval(showing)
    }
  }, [booted, contract, session])

  const start = useCallback(async () => {
    // Both in the same gesture. iOS requires requestPermission to be reached
    // from a tap, and an AudioContext needs one too, so asking for them
    // separately would mean two taps for no reason.
    const permission = await requestMotion()
    if (permission === 'denied') setDenied(true)
    boot()
  }, [boot])

  return (
    <main className="flex min-h-dvh flex-col bg-canvas text-neutral-200">
      <PageHeader title="imu" />

      <div className="pad-safe-x mx-auto flex w-full max-w-md flex-1 flex-col gap-6 pt-6">
        <p className="text-sm text-neutral-500">
          A drone that never stops. The phone&rsquo;s orientation is the instrument &mdash; tilt it,
          turn it, shake it.
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
            Motion access was refused, so the drone will sound but not move. Safari remembers this
            per site: Settings → Safari → Motion &amp; Orientation Access, then reload.
          </p>
        ) : null}

        {booted && !motion.live && !denied ? (
          <p className="rounded border border-neutral-800 bg-surface p-3 text-sm text-neutral-500">
            Sounding, but no orientation events have arrived. This page needs a phone or a tablet
            with motion sensors &mdash; on a desktop browser there is nothing to tilt.
          </p>
        ) : null}

        {booted ? (
          <>
            <Axis label="roll" hint="tilt left / right → brightness" value={motion.roll} bipolar />
            <Axis label="pitch" hint="tilt toward / away → note" value={motion.pitch} bipolar />
            <Axis label="yaw" hint="turn around → detune, width" value={motion.yaw * 2 - 1} bipolar />
            <Axis
              label="shake"
              hint={motion.hasAcceleration ? 'shake → drift' : 'no linear acceleration reported'}
              value={motion.shake * 2 - 1}
              bipolar
            />
          </>
        ) : null}

        <div className="mt-auto" />
      </div>

      {booted ? <EngineFooter /> : null}
    </main>
  )
}

/** A bar that reads at a glance while the phone is moving and you are not looking carefully. */
function Axis({
  label,
  hint,
  value,
  bipolar,
}: {
  label: string
  hint: string
  value: number
  bipolar: boolean
}) {
  const position = bipolar ? (value + 1) / 2 : value

  return (
    <div data-testid={`axis-${label}`}>
      <div className="flex items-baseline justify-between font-mono text-xs">
        <span className="text-neutral-300">{label}</span>
        <span className="text-neutral-600">{hint}</span>
      </div>

      <div className="relative mt-1 h-2 rounded bg-neutral-800">
        {/* Centre mark, because a bar with no reference does not show which way
            is neutral — and on a bipolar axis that is the thing you aim for. */}
        <div className="absolute inset-y-0 left-1/2 w-px bg-neutral-700" />
        <div
          className="absolute inset-y-0 w-2 rounded bg-emerald-400"
          style={{ left: `calc(${(Math.min(1, Math.max(0, position)) * 100).toFixed(1)}% - 4px)` }}
        />
      </div>
    </div>
  )
}
