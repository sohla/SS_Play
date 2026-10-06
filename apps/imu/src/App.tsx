import { useCallback, useEffect, useRef, useState } from 'react'
import { ctl, mapSpec, type SynthDefContract } from '@ss/engine'
import { useSuperSonic } from '@ss/react'
import { BootGate, EngineFooter, PageHeader } from '@ss/ui'
import { unipolar } from '@ss/motion'
import { RESTING, requestMotion, watchMotion, type Motion } from '@ss/motion'

const DEF = 'ssp_drone'

/**
 * Which movement drives which control.
 *
 * Two kinds of input, doing two different jobs. Orientation is a position: it
 * holds wherever you leave it, so it sets the steady state. Acceleration is a
 * derivative: it reads zero whenever the phone is still, however it is held, so
 * it can only ever add movement on top. Mapping a derivative to something that
 * should hold — the note, say — gives a control that springs back to the middle
 * the moment you stop moving.
 *
 * Every value arrives as 0..1 and goes through the SynthDef's own spec, so the
 * ranges and curves are the ones declared beside the UGen graph. A tilt does
 * not know what a cutoff is, and nothing here repeats a number from the def.
 */
const MAPPING = [
  { motion: 'roll', param: 'cutoff' },
  { motion: 'pitch', param: 'freq' },
  { motion: 'yaw', param: 'detune' },
  { motion: 'accelX', param: 'spread' },
  { motion: 'accelY', param: 'amp' },
  { motion: 'accelZ', param: 'rq' },
  { motion: 'shake', param: 'shimmer' },
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

        values[param] = mapSpec(spec, unitFor(source, now))
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
            <section className="flex flex-col gap-3">
              <h2 className="font-mono text-[10px] uppercase tracking-wider text-neutral-600">
                orientation · holds where you leave it
              </h2>
              <Axis id="roll" label="roll" hint="tilt left / right → brightness" value={motion.roll} />
              <Axis id="pitch" label="pitch" hint="tilt toward / away → note" value={motion.pitch} />
              <Axis id="yaw" label="yaw" hint="turn around → detune" value={motion.yaw * 2 - 1} />
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="font-mono text-[10px] uppercase tracking-wider text-neutral-600">
                acceleration · returns to centre
                {motion.hasAcceleration ? '' : ' · not reported by this device'}
              </h2>
              <Axis id="accelX" label="accel x" hint="side to side → stereo width" value={motion.accelX} />
              <Axis id="accelY" label="accel y" hint="up / down → level" value={motion.accelY} />
              <Axis id="accelZ" label="accel z" hint="toward / away → resonance" value={motion.accelZ} />
              <Axis id="shake" label="shake" hint="any direction → drift" value={motion.shake * 2 - 1} />
            </section>
          </>
        ) : null}

        <div className="mt-auto" />
      </div>

      {booted ? <EngineFooter /> : null}
    </main>
  )
}

/** 0..1 for a spec, from whichever axis drives it. */
function unitFor(source: (typeof MAPPING)[number]['motion'], motion: Motion): number {
  switch (source) {
    case 'roll':
      return unipolar(motion.roll)
    case 'pitch':
      return unipolar(motion.pitch)
    case 'yaw':
      return motion.yaw
    case 'accelX':
      return unipolar(motion.accelX)
    case 'accelY':
      return unipolar(motion.accelY)
    case 'accelZ':
      return unipolar(motion.accelZ)
    case 'shake':
      return motion.shake
  }
}

/** A bar that reads at a glance while the phone is moving and you are not looking carefully. */
function Axis({
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
  const position = (value + 1) / 2

  return (
    <div data-testid={`axis-${id}`}>
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
