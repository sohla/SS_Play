import { useCallback, useEffect, useRef, useState } from 'react'
import { HeldVoice, NTP_EPOCH_OFFSET, ctl, i, wallClockMs } from '@ss/engine'
import { useSuperSonic } from '@ss/react'
import { BootGate, EngineFooter, PageHeader, SourceFooter } from '@ss/ui'
import { agreement, createCaller, createClock, due, hear, phaseAt, type Caller } from './chorus.ts'

/**
 * Devices that call, listen for each other, and slowly fall into step. See
 * `chorus.ts` for the model; this file is the plumbing between it and the engine.
 *
 * `?loopback=1` listens to the page's own output instead of the microphone, and
 * `&voices=N` runs N callers in one page — a room in a tab, for tests and for
 * watching the maths without a second device.
 */

const params = new URLSearchParams(location.search)
const LOOPBACK = params.get('loopback') === '1'
const VOICES = LOOPBACK ? Math.max(1, Math.min(8, Number(params.get('voices') ?? 1))) : 1

/**
 * Everything off. Echo cancellation would remove our own call — the one thing
 * this page needs to hear to know its delay — and noise suppression and AGC
 * reshape exactly the short, high, tonal sound the detector is built for.
 */
const CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
}

/** How far ahead a call is committed to a timetagged bundle. */
const LOOKAHEAD_MS = 150

type Mic = 'off' | 'asking' | 'live' | 'denied' | 'unavailable' | 'failed'

interface Readout {
  delay: string
  period: string
  r: number
  offset: string
  heard: number
  calls: number
}

const EMPTY: Readout = { delay: '…', period: '…', r: 0, offset: '—', heard: 0, calls: 0 }

/** The OSC codec is a static on the SuperSonic class, not the instance. */
interface OscCodec {
  encodeSingleBundle(timeTag: number, address: string, args: unknown[]): Uint8Array
}

export function App() {
  const { status, boot, probe, session } = useSuperSonic()
  const booted = status.phase === 'ready' || status.phase === 'degraded'

  const [mic, setMic] = useState<Mic>(LOOPBACK ? 'live' : 'off')
  const [problem, setProblem] = useState('')
  const stream = useRef<MediaStream | null>(null)

  // Read by timers and the frame loop, never through React.
  const callers = useRef<Caller[]>([])
  const calls = useRef(0)
  const [readout, setReadout] = useState<Readout>(EMPTY)

  /** One tap for both: the AudioContext and Safari's mic prompt each need a gesture. */
  const start = useCallback(() => {
    if (!LOOPBACK) {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMic('unavailable')
      } else {
        setMic('asking')
        navigator.mediaDevices.getUserMedia(CONSTRAINTS).then(
          (granted) => {
            stream.current = granted
            setMic('live')
          },
          (error: DOMException) => {
            setMic(error.name === 'NotAllowedError' ? 'denied' : 'failed')
            setProblem(error.message)
          },
        )
      }
    }
    boot()
  }, [boot])

  useEffect(() => {
    const engine = session()
    if (!booted || !engine || mic !== 'live') return
    const context = engine.sonic.audioContext
    const node = engine.sonic.node
    const codec = (engine.sonic as unknown as { constructor: { osc?: OscCodec } }).constructor.osc
    if (!context || !node || !codec) return

    let source: MediaStreamAudioSourceNode | null = null
    if (!LOOPBACK && stream.current) {
      source = context.createMediaStreamSource(stream.current)
      source.connect(node.input)
    }

    // First, so every call — added at the head after it — runs before it in the
    // block. In loopback that is what lets it hear them on the output bus.
    const listener = new HeldVoice({
      session: engine,
      def: 'ssp_call_listen',
      initial: { in: LOOPBACK ? 0 : 2 },
    })

    const now = wallClockMs()
    callers.current = Array.from({ length: VOICES }, () => createCaller(now))
    const clock = createClock(context.sampleRate, wallClockMs())

    const heard = engine.dispatcher.on('/ssp_heard', (message) => {
      // SendReply sends [address, nodeId, replyId, frame, score].
      const frame = message[3]
      if (typeof frame !== 'number') return
      const detectorMs = clock(frame)
      const receivedAt = wallClockMs()
      for (const caller of callers.current) hear(caller, detectorMs, receivedAt)
    })

    const scheduling = setInterval(() => {
      const horizon = wallClockMs() + LOOKAHEAD_MS
      callers.current.forEach((caller, index) => {
        const at = due(caller, horizon)
        if (at === null) return
        const pan = VOICES > 1 ? -0.6 + (1.2 * index) / (VOICES - 1) : 0
        engine.sonic.sendOSC(
          codec.encodeSingleBundle(at / 1000 + NTP_EPOCH_OFFSET, '/s_new', [
            'ssp_call',
            i(engine.sonic.nextNodeId()),
            i(0),
            i(0),
            ...ctl({ amp: 0.3, pan }),
          ]),
        )
        calls.current += 1
      })
    }, 25)

    return () => {
      clearInterval(scheduling)
      heard()
      listener.dispose()
      source?.disconnect()
      callers.current = []
    }
  }, [booted, session, mic])

  useEffect(() => () => stream.current?.getTracks().forEach((track) => track.stop()), [])

  // The readout, at 4Hz.
  useEffect(() => {
    if (!booted) return
    const timer = setInterval(() => {
      const caller = callers.current[0]
      if (!caller) return
      const now = wallClockMs()
      const { r, offsetMs, count } = agreement(caller, now)
      setReadout({
        delay: caller.delay === null ? 'calibrating…' : `${Math.round(caller.delay)}ms`,
        period: `${caller.period.toFixed(0)}ms`,
        r,
        offset: count > 0 ? `${offsetMs >= 0 ? '+' : ''}${offsetMs.toFixed(0)}ms` : '—',
        heard: count,
        calls: calls.current,
      })
    }, 250)
    return () => clearInterval(timer)
  }, [booted])

  // The picture, per frame: our phase round a circle, a glow when we call, and a
  // tick for every call heard, where in our cycle it landed.
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!booted) return
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    let frame = 0

    const draw = () => {
      const size = element.clientWidth
      const dpr = Math.min(devicePixelRatio || 1, 2)
      if (element.width !== Math.round(size * dpr)) {
        element.width = element.height = Math.round(size * dpr)
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, size, size)

      const caller = callers.current[0]
      const centre = size / 2
      const radius = size * 0.38
      const now = wallClockMs()
      const accent = getComputedStyle(element).getPropertyValue('--ak-accent').trim() || '#ff0'

      // The glow: bright as we call, fading over half a second. One flash per
      // ~2s, far under any photosensitivity threshold.
      const since = caller?.fires.at(-1) !== undefined ? now - caller.fires.at(-1)! : Infinity
      const glow = since >= 0 ? Math.max(0, 1 - since / 500) : 0
      if (glow > 0) {
        const gradient = context.createRadialGradient(centre, centre, 0, centre, centre, radius)
        gradient.addColorStop(0, `rgba(255, 255, 0, ${0.55 * glow})`)
        gradient.addColorStop(1, 'rgba(255, 255, 0, 0)')
        context.fillStyle = gradient
        context.beginPath()
        context.arc(centre, centre, radius, 0, 2 * Math.PI)
        context.fill()
      }

      context.strokeStyle = '#333'
      context.lineWidth = 1.5
      context.beginPath()
      context.arc(centre, centre, radius, 0, 2 * Math.PI)
      context.stroke()

      if (caller) {
        // Others' calls, at the point in our cycle they landed. 12 o'clock is
        // our own call, so a chorus in step is a cluster at the top.
        for (const { calledAt, offsetMs } of caller.heard) {
          const age = (now - calledAt) / (2 * caller.period)
          if (age < 0 || age > 1) continue
          const angle = (2 * Math.PI * offsetMs) / caller.period - Math.PI / 2
          context.strokeStyle = `rgba(0, 255, 255, ${1 - age})`
          context.lineWidth = 3
          context.beginPath()
          context.moveTo(centre + Math.cos(angle) * radius * 0.86, centre + Math.sin(angle) * radius * 0.86)
          context.lineTo(centre + Math.cos(angle) * radius * 1.14, centre + Math.sin(angle) * radius * 1.14)
          context.stroke()
        }

        const angle = 2 * Math.PI * phaseAt(caller, now) - Math.PI / 2
        context.fillStyle = accent
        context.beginPath()
        context.arc(centre + Math.cos(angle) * radius, centre + Math.sin(angle) * radius, 7, 0, 2 * Math.PI)
        context.fill()
      }

      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [booted])

  const live = booted && mic === 'live'

  return (
    <main className="ak flex min-h-dvh flex-col">
      <PageHeader title="chorus" />

      <div className="pad-safe-x mx-auto flex w-full max-w-md flex-1 flex-col gap-5 pt-6">
        <p className="ak-label text-sm">
          Each device whistles a short bird call and listens for the others&rsquo;. Every call it
          hears nudges its own a little earlier or later &mdash; the way fireflies and crickets
          come to flash and chirp together &mdash; so a few phones in a room drift into one
          chorus over a minute or two. It hears itself too, to learn how late its own speaker
          and microphone are. A whistled falling note will join in.
        </p>

        <BootGate
          phase={status.phase}
          error={status.error}
          degradedReason={status.degradedReason}
          sabUnavailable={probe.sabUnavailable}
          onBoot={start}
        />

        {mic === 'asking' ? (
          <p className="ss-waiting ak-panel rounded border p-3 text-sm">
            Waiting for the browser&rsquo;s microphone prompt.
          </p>
        ) : null}
        {mic === 'denied' ? (
          <p className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
            Microphone access was refused. It is how this page hears the others: allow it for this
            site in the browser&rsquo;s settings, then reload.
          </p>
        ) : null}
        {mic === 'unavailable' || mic === 'failed' ? (
          <p className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
            {mic === 'unavailable'
              ? 'This browser offers no microphone here. It needs HTTPS and a recent browser.'
              : `The microphone could not be opened: ${problem}`}
          </p>
        ) : null}

        {live ? (
          <>
            <canvas ref={canvas} className="aspect-square w-full" data-testid="chorus-circle" />

            <dl className="ak-label grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px]">
              <Row name="own delay" value={readout.delay} />
              <Row name="period" value={readout.period} />
              <Row name="heard" value={String(readout.heard)} />
              <Row name="calls" value={String(readout.calls)} />
              <Row name="together" value={readout.heard > 0 ? readout.r.toFixed(2) : '—'} />
              <Row name="offset" value={readout.offset} />
            </dl>

            <p className="ak-label font-mono text-[11px]">
              <strong className="ak-accent">together</strong> is Kuramoto&rsquo;s order parameter
              over the calls heard lately: 1 when they all land on this device&rsquo;s own, near 0
              when they are spread round its cycle. <strong className="ak-accent">own delay</strong>{' '}
              stays at calibrating if this device cannot hear itself &mdash; turn it up.
            </p>
          </>
        ) : null}

        <div className="mt-auto" />
      </div>

      {booted ? <EngineFooter /> : null}
      <SourceFooter />
    </main>
  )
}

function Row({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-[var(--ak-line)] py-0.5">
      <dt>{name}</dt>
      <dd className="ak-accent" data-testid={`value-${name.replace(' ', '-')}`}>
        {value}
      </dd>
    </div>
  )
}
