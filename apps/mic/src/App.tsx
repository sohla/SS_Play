import { useCallback, useEffect, useRef, useState } from 'react'
import { HeldVoice, i } from '@ss/engine'
import { useOscTap, useSuperSonic } from '@ss/react'
import { BootGate, EngineFooter, PageHeader, SourceFooter } from '@ss/ui'

/**
 * The microphone, into scsynth, driving a voice's amp.
 *
 * The mic is a `MediaStreamSource` connected to the engine's worklet input, so
 * it arrives on scsynth's first hardware input bus. `ssp_mic_follow` follows its
 * level onto a control bus, and `ssp_mb_drone` — unchanged — has its `amp`
 * mapped to that bus. The level never passes through JavaScript on its way to
 * the sound; the page only listens in, for the meter.
 */

/** The control bus the follower writes and the drone reads. This page's own engine, so any is free. */
const LEVEL_BUS = 0

/**
 * What the browser was asked for.
 *
 * Echo cancellation stays **on**, unlike most music use, because this page plays
 * what it hears: the drone comes out of the speaker, goes back into the mic,
 * and turns itself up. Cancelling the page's own output is the one processing
 * step that breaks that loop. The other two would flatten the very level being
 * followed.
 */
const CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
}

type Mic = 'off' | 'asking' | 'live' | 'denied' | 'unavailable' | 'failed'

/** The meter's floor. Below this it reads as empty. */
const FLOOR_DB = -60

/**
 * How fast the meter falls, in dB a second.
 *
 * `Amplitude` lets go of a click within a frame or two, so drawn raw a short
 * sound is lit for one frame and nobody sees it. Instant rise and a steady fall
 * is what a hardware meter does. Display only: the drone follows the raw level.
 */
const FALL_DB_PER_S = 20

export function App() {
  const { status, boot, probe, session } = useSuperSonic()
  const booted = status.phase === 'ready' || status.phase === 'degraded'

  const [mic, setMic] = useState<Mic>('off')
  const [problem, setProblem] = useState('')
  const stream = useRef<MediaStream | null>(null)
  const asked = useRef<Promise<MediaStream> | null>(null)

  /**
   * One tap does both. An AudioContext only starts from a gesture, and Safari
   * only shows the mic prompt for one, so the permission request is made here,
   * synchronously, rather than after the engine has booted.
   */
  const start = useCallback(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      // Absent outside a secure context, and on very old browsers.
      setMic('unavailable')
    } else {
      setMic('asking')
      asked.current = navigator.mediaDevices.getUserMedia(CONSTRAINTS)
      asked.current.then(
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
    boot()
  }, [boot])

  // Into the engine, once both have arrived.
  useEffect(() => {
    const engine = session()
    const granted = stream.current
    if (!booted || !engine || mic !== 'live' || !granted) return

    const context = engine.sonic.audioContext
    const node = engine.sonic.node
    if (!context || !node) return
    const source = context.createMediaStreamSource(granted)
    source.connect(node.input)

    // The voice first, so the follower can go in at the head and run ahead of
    // it in the same block.
    const voice = new HeldVoice({
      session: engine,
      def: 'ssp_mb_drone',
      initial: { amp: 0, freq: 110, ffreq: 1200 },
    })
    const follower = new HeldVoice({
      session: engine,
      def: 'ssp_mic_follow',
      initial: { bus: LEVEL_BUS },
    })
    // /n_map's bus index is an int, unlike a control value.
    if (voice.node !== null) engine.sonic.send('/n_map', voice.node, 'amp', i(LEVEL_BUS))

    return () => {
      follower.dispose()
      voice.dispose()
      source.disconnect()
    }
  }, [booted, session, mic])

  // Let the mic go when the page does, so the browser's recording light goes out.
  useEffect(() => () => stream.current?.getTracks().forEach((track) => track.stop()), [])

  // The meter. Written by the OSC tap, drawn by a frame loop, never through React.
  const level = useRef(0)
  const bar = useRef<HTMLDivElement>(null)
  const readout = useRef<HTMLSpanElement>(null)

  useOscTap(
    '/ssp_mic',
    (message) => {
      // SendReply sends [address, nodeId, replyId, ...values].
      const value = message[3]
      if (typeof value === 'number') level.current = value
    },
    [booted],
  )

  useEffect(() => {
    if (!booted) return
    let frame = 0
    let shown = -Infinity
    let then = performance.now()
    const draw = (now: number) => {
      const heard = level.current > 0 ? 20 * Math.log10(level.current) : -Infinity
      shown = Math.max(heard, shown - (FALL_DB_PER_S * (now - then)) / 1000)
      then = now
      const db = shown
      const fill = Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB))
      if (bar.current) bar.current.style.width = `${(fill * 100).toFixed(1)}%`
      if (readout.current) readout.current.textContent = db > FLOOR_DB ? `${db.toFixed(1)} dB` : 'silent'
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [booted])

  return (
    <main className="ak flex min-h-dvh flex-col">
      <PageHeader title="mic" />

      <div className="pad-safe-x mx-auto flex w-full max-w-md flex-1 flex-col gap-5 pt-6">
        <p className="ak-label text-sm">
          The microphone, into SuperCollider. Its level drives a drone&rsquo;s volume &mdash; make
          a sound and it swells, go quiet and it fades. Starting asks the browser for the
          microphone. Headphones keep the drone out of the mic.
        </p>

        <BootGate
          phase={status.phase}
          error={status.error}
          degradedReason={status.degradedReason}
          sabUnavailable={probe.sabUnavailable}
          onBoot={start}
        />

        {mic === 'asking' ? (
          <p className="ss-waiting ak-panel rounded border p-3 text-sm" data-testid="mic-status">
            Waiting for the browser&rsquo;s microphone prompt.
          </p>
        ) : null}

        {mic === 'denied' ? (
          <p
            className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300"
            data-testid="mic-status"
          >
            Microphone access was refused. Allow it for this site in the browser&rsquo;s settings
            (the icon beside the address bar), then reload.
          </p>
        ) : null}

        {mic === 'unavailable' || mic === 'failed' ? (
          <p
            className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300"
            data-testid="mic-status"
          >
            {mic === 'unavailable'
              ? 'This browser offers no microphone here. It needs HTTPS and a recent browser.'
              : `The microphone could not be opened: ${problem}`}
          </p>
        ) : null}

        {booted && mic === 'live' ? (
          <div className="flex flex-col gap-2" data-testid="mic-status">
            <div className="ak-label flex justify-between font-mono text-[11px]">
              <span>mic level</span>
              <span className="ak-accent" ref={readout} data-testid="mic-db">
                silent
              </span>
            </div>
            <div className="ak-panel h-6 overflow-hidden rounded border">
              <div
                ref={bar}
                data-testid="mic-meter"
                className="h-full bg-[var(--ak-accent)]"
                style={{ width: '0%' }}
              />
            </div>
          </div>
        ) : null}

        <div className="mt-auto" />
      </div>

      {booted ? <EngineFooter /> : null}
      <SourceFooter />
    </main>
  )
}
