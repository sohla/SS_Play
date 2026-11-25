import { useCallback, useEffect, useRef, useState } from 'react'
import { HeldVoice, NTP_EPOCH_OFFSET, ctl, i, wallClockMs } from '@ss/engine'
import { useSuperSonic } from '@ss/react'
import { BootGate, EngineFooter, PageHeader, SourceFooter } from '@ss/ui'
import { LOOP_S, Loop, ampOf, frameToMs, midiOf } from './memory.ts'
import { SYNTHS } from './synths.ts'

/**
 * The microphone's onsets, remembered for ten seconds and played back on a loop
 * by a synth, dissolving a little each time round.
 *
 * `ssp_onset_listen` listens in scsynth and reports each onset with the sample it
 * started on, its peak and its pitch. The page places it in the loop, and a
 * scheduler sends every note ahead of time as a timetagged bundle, as /chorus/
 * does, so the pattern keeps the time it was heard in.
 */

/**
 * What the browser was asked for, as on /mic/. Echo cancellation stays on: the
 * loop comes out of the speaker, and without it every note played back would be
 * heard again as a new onset and the memory would fill itself.
 */
const CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
}

type Mic = 'off' | 'asking' | 'live' | 'denied' | 'unavailable' | 'failed'

const LOOKAHEAD_MS = 120

/** The dissolve slider, 0..1, is this much life lost a pass at the top. */
const MOST_PER_PASS = 0.5

interface OscCodec {
  encodeSingleBundle(timeTag: number, address: string, args: unknown[]): Uint8Array
}

export function App() {
  const { status, boot, probe, session } = useSuperSonic()
  const booted = status.phase === 'ready' || status.phase === 'degraded'

  const [mic, setMic] = useState<Mic>('off')
  const [problem, setProblem] = useState('')
  const stream = useRef<MediaStream | null>(null)

  const [synthName, setSynthName] = useState<string>(SYNTHS[0].name)
  const [dissolve, setDissolve] = useState(0.2)
  // Read by the scheduler, which is not a React render.
  const synth = useRef(SYNTHS[0] as (typeof SYNTHS)[number])
  synth.current = SYNTHS.find((one) => one.name === synthName) ?? SYNTHS[0]
  const rate = useRef(dissolve)
  rate.current = dissolve * MOST_PER_PASS

  const loop = useRef<Loop | null>(null)

  /** One tap for both: the AudioContext and Safari's mic prompt each need a gesture. */
  const start = useCallback(() => {
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
    boot()
  }, [boot])

  useEffect(() => {
    const engine = session()
    const granted = stream.current
    if (!booted || !engine || mic !== 'live' || !granted) return
    const context = engine.sonic.audioContext
    const node = engine.sonic.node
    const codec = (engine.sonic as unknown as { constructor: { osc?: OscCodec } }).constructor.osc
    if (!context || !node || !codec) return

    const source = context.createMediaStreamSource(granted)
    source.connect(node.input)

    const listener = new HeldVoice({ session: engine, def: 'ssp_onset_listen', initial: {} })
    const origin = wallClockMs()
    const memory = new Loop(origin)
    loop.current = memory

    const heard = engine.dispatcher.on('/ssp_onset', (message) => {
      // SendReply sends [address, nodeId, replyId, frame, peak, freq, hasFreq].
      const [frame, peak, freq, hasFreq] = message.slice(3) as number[]
      if (typeof frame !== 'number' || typeof peak !== 'number') return
      const ms = frameToMs(frame, wallClockMs(), origin, context.sampleRate)
      memory.hear(ms, peak, midiOf(freq ?? 0, hasFreq ?? 0))
    })

    const scheduling = setInterval(() => {
      const now = wallClockMs()
      memory.catchUp(now)
      for (const { ms, note } of memory.due(now + LOOKAHEAD_MS, rate.current)) {
        const { def, level } = synth.current
        engine.sonic.sendOSC(
          codec.encodeSingleBundle(ms / 1000 + NTP_EPOCH_OFFSET, '/s_new', [
            def,
            i(engine.sonic.nextNodeId()),
            i(0),
            i(0),
            ...ctl({ note: note.midi, amp: level * ampOf(note) }),
          ]),
        )
      }
    }, 25)

    return () => {
      clearInterval(scheduling)
      heard()
      listener.dispose()
      source.disconnect()
      loop.current = null
    }
  }, [booted, session, mic])

  // Let the mic go when the page does, so the browser's recording light goes out.
  useEffect(() => () => stream.current?.getTracks().forEach((track) => track.stop()), [])

  // The loop, drawn each frame from the model, never through React: a playhead,
  // and each note where it falls, as high as its pitch, as big as its peak, as
  // bright as the life it has left.
  const canvas = useRef<HTMLCanvasElement>(null)
  const count = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!booted) return
    let frame = 0
    const draw = () => {
      const surface = canvas.current
      const pen = surface?.getContext('2d')
      const memory = loop.current
      if (surface && pen) {
        const scale = window.devicePixelRatio || 1
        const width = surface.clientWidth * scale
        const height = surface.clientHeight * scale
        if (surface.width !== width || surface.height !== height) {
          surface.width = width
          surface.height = height
        }
        const accent = getComputedStyle(surface).color
        pen.clearRect(0, 0, width, height)
        if (memory) {
          pen.fillStyle = accent
          for (const note of memory.notes) {
            const x = (note.at / LOOP_S) * width
            const y = height * (1 - Math.max(0, Math.min(1, (note.midi - 36) / 60)))
            pen.globalAlpha = Math.max(0.08, note.life)
            pen.beginPath()
            pen.arc(x, y, (3 + 9 * ampOf({ ...note, life: 1 })) * scale, 0, Math.PI * 2)
            pen.fill()
          }
          pen.globalAlpha = 0.6
          pen.fillRect((memory.positionOf(wallClockMs()) / LOOP_S) * width, 0, scale, height)
          pen.globalAlpha = 1
        }
      }
      if (count.current) count.current.textContent = String(memory?.notes.length ?? 0)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [booted])

  return (
    <main className="ak flex min-h-dvh flex-col">
      <PageHeader title="memory" />

      <div className="pad-safe-x mx-auto flex w-full max-w-md flex-1 flex-col gap-5 pt-6">
        <p className="ak-label text-sm">
          The microphone, remembered for ten seconds. Every sound that starts &mdash; a clap, a
          knock, a sung note &mdash; becomes a note in the loop, played back by the synth you pick.
          Each time round the notes fade, unevenly, until only fragments are left and there is room
          for more. Starting asks the browser for the microphone.
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
          <div className="flex flex-col gap-4" data-testid="memory">
            <div className="flex flex-col gap-1">
              <div className="ak-label flex justify-between font-mono text-[11px]">
                <span>ten seconds</span>
                <span>
                  <span className="ak-accent" ref={count} data-testid="notes">
                    0
                  </span>{' '}
                  notes
                </span>
              </div>
              <canvas ref={canvas} className="ak-panel ak-accent h-40 w-full rounded border" />
            </div>

            <label className="ak-label flex items-center gap-3 text-sm">
              <span className="w-20 shrink-0">synth</span>
              <select
                value={synthName}
                onChange={(event) => setSynthName(event.target.value)}
                className="ak-panel min-h-11 flex-1 rounded border px-2 text-sm"
                data-testid="synth"
              >
                {SYNTHS.map((one) => (
                  <option key={one.name} value={one.name}>
                    {one.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="ak-label flex items-center gap-3 text-sm">
              <span className="w-20 shrink-0">dissolve</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={dissolve}
                onChange={(event) => setDissolve(Number(event.target.value))}
                className="ss-range min-w-0 flex-1"
                data-testid="dissolve"
              />
              <span className="ak-accent w-20 shrink-0 text-right font-mono text-[11px]">
                {dissolve === 0 ? 'never' : `~${Math.round(1 / (dissolve * MOST_PER_PASS))} loops`}
              </span>
            </label>
          </div>
        ) : null}

        <div className="mt-auto" />
      </div>

      {booted ? <EngineFooter /> : null}
      <SourceFooter />
    </main>
  )
}
