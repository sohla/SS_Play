import { useCallback, useEffect, useRef, useState } from 'react'
import { HeldVoice, NTP_EPOCH_OFFSET, ctl, i, wallClockMs } from '@ss/engine'
import { useSuperSonic } from '@ss/react'
import { BootGate, EngineFooter, PageHeader, SourceFooter } from '@ss/ui'
import { LOOP_S, LOWEST, Loop, SPAN, ampOf, frameToMs, midiOf } from './memory.ts'
import { SYNTHS } from './synths.ts'

/**
 * The microphone's onsets, remembered for three seconds and played back on a loop
 * by a synth, dissolving a little each time round.
 *
 * `ssp_onset_listen` listens in scsynth and reports each onset with the sample it
 * started on and its peak, which sets both its note and how loud it plays. The
 * page places it in the loop, and a scheduler sends every note ahead of time as
 * a timetagged bundle, as /chorus/ does, so the pattern keeps the time it was
 * heard in.
 */

/**
 * What the browser was asked for: the mic as it is, as on /chorus/.
 *
 * Echo cancellation is **off**. It did not stop the loop being heard again —
 * the browser does not cancel the engine's output, which is what `DEAF_MS` is
 * for — and on an iPhone it is the voice processing that turns the page into a
 * phone call, with the sound moved to the earpiece at the top.
 */
const CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
}

/**
 * Safari's Audio Session API, where there is one: "play-and-record", set before
 * the mic is opened, is the one lever a page has to keep iOS on the loudspeaker
 * once it records. As in the onboarding, it is reported to help, not to always
 * work; no web API picks the speaker on iOS. Never "playback", which silenced
 * Web Audio on the iPhone there.
 */
function playAndRecord() {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (!session) return
  try {
    session.type = 'play-and-record'
  } catch {
    // An older Safari that has the object but not this type.
  }
}

type Mic = 'off' | 'asking' | 'live' | 'denied' | 'unavailable' | 'failed'

const LOOKAHEAD_MS = 120

/** The meter's floor, and the bottom of the gate's range. Below this it reads as empty. */
const METER_DB = -60

/**
 * Where the noise gate starts. Low, so a soft tap gets through, but above the
 * hum of a quiet room, which a phone's mic puts somewhere around -50dB.
 */
const GATE_DB = -40

/** How fast the meter falls, in dB a second, as on /mic/: a click is otherwise lit for one frame. */
const FALL_DB_PER_S = 20

/** The dissolve slider's top: this many notes die each time round. */
const MOST_DYING = 8

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
  const [dissolve, setDissolve] = useState(2)
  // Read by the scheduler, which is not a React render.
  const synth = useRef(SYNTHS[0] as (typeof SYNTHS)[number])
  synth.current = SYNTHS.find((one) => one.name === synthName) ?? SYNTHS[0]
  const dying = useRef(dissolve)
  dying.current = dissolve

  const loop = useRef<Loop | null>(null)

  const [gateDb, setGateDb] = useState(GATE_DB)
  const gate = useRef(gateDb)
  gate.current = gateDb
  const listener = useRef<HeldVoice | null>(null)
  /** The input's level, written by the listener's reports and read by the frame loop. */
  const level = useRef(0)

  /** One tap for both: the AudioContext and Safari's mic prompt each need a gesture. */
  const start = useCallback(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMic('unavailable')
    } else {
      setMic('asking')
      playAndRecord()
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

    const listening = new HeldVoice({
      session: engine,
      def: 'ssp_onset_listen',
      initial: { floor: 10 ** (gate.current / 20) },
    })
    listener.current = listening
    const origin = wallClockMs()
    const memory = new Loop(origin)
    loop.current = memory

    const heard = engine.dispatcher.on('/ssp_onset', (message) => {
      // SendReply sends [address, nodeId, replyId, frame, peak, freq, hasFreq].
      // The pitch is not used: the note comes from how loud the onset was.
      const [frame, peak] = message.slice(3) as number[]
      if (typeof frame !== 'number' || typeof peak !== 'number') return
      const ms = frameToMs(frame, wallClockMs(), origin, context.sampleRate)
      memory.hear(ms, peak, midiOf(peak))
    })

    const metering = engine.dispatcher.on('/ssp_onset_level', (message) => {
      const value = message[3]
      if (typeof value === 'number') level.current = value
    })

    const scheduling = setInterval(() => {
      const now = wallClockMs()
      memory.catchUp(now)
      for (const { ms, note } of memory.due(now + LOOKAHEAD_MS, dying.current)) {
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
      metering()
      listening.dispose()
      listener.current = null
      source.disconnect()
      loop.current = null
    }
  }, [booted, session, mic])

  useEffect(() => listener.current?.set({ floor: 10 ** (gateDb / 20) }), [gateDb])

  // Let the mic go when the page does, so the browser's recording light goes out.
  useEffect(() => () => stream.current?.getTracks().forEach((track) => track.stop()), [])

  // The loop, drawn each frame from the model, never through React: a playhead,
  // and each note where it falls, as high as its note and as big as its peak.
  const canvas = useRef<HTMLCanvasElement>(null)
  const count = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!booted) return
    let frame = 0
    let shown = -Infinity
    let then = performance.now()
    const draw = (now: number) => {
      const heard = level.current > 0 ? 20 * Math.log10(level.current) : -Infinity
      shown = Math.max(heard, shown - (FALL_DB_PER_S * (now - then)) / 1000)
      then = now
      if (bar.current) {
        bar.current.style.width = `${(100 * fillOf(shown)).toFixed(1)}%`
        // Lit while the input is over the gate, where an onset can happen.
        bar.current.style.opacity = heard > gate.current ? '1' : '0.3'
      }
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
            const y = height * (1 - Math.max(0, Math.min(1, (note.midi - LOWEST) / SPAN)))
            pen.globalAlpha = 0.85
            pen.beginPath()
            pen.arc(x, y, (3 + 9 * ampOf(note)) * scale, 0, Math.PI * 2)
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
          The microphone, remembered for three seconds. Every sound that starts &mdash; a clap, a
          knock, a word &mdash; becomes a note in the loop, played back by the synth you pick: the
          louder the sound, the higher the note. Each time round, some of the notes die, picked at
          random, until only fragments are left and there is room for more. The slider sets how
          many. Sounds below the gate, the line on the input meter, are ignored. Starting asks the
          browser for the microphone.
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
                <span>input</span>
                <span>gate {gateDb} dB</span>
              </div>
              <div className="ak-panel relative h-6 overflow-hidden rounded border">
                <div ref={bar} data-testid="input-meter" className="h-full bg-[var(--ak-accent)]" style={{ width: '0%' }} />
                <div
                  aria-hidden="true"
                  className="absolute inset-y-0 w-0.5 bg-current"
                  style={{ left: `${100 * fillOf(gateDb)}%` }}
                />
              </div>
              <input
                type="range"
                min={METER_DB}
                max={-10}
                step={1}
                value={gateDb}
                onChange={(event) => setGateDb(Number(event.target.value))}
                className="ss-range w-full"
                aria-label="noise gate"
                data-testid="gate"
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="ak-label flex justify-between font-mono text-[11px]">
                <span>three seconds</span>
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
                max={MOST_DYING}
                step={1}
                value={dissolve}
                onChange={(event) => setDissolve(Number(event.target.value))}
                className="ss-range min-w-0 flex-1"
                data-testid="dissolve"
              />
              <span className="ak-accent w-20 shrink-0 text-right font-mono text-[11px]">
                {dissolve === 0 ? 'none die' : `${dissolve} die a loop`}
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

/** Where a level in dB sits on the meter, 0..1. */
function fillOf(db: number): number {
  return Math.max(0, Math.min(1, (db - METER_DB) / -METER_DB))
}
