import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { HeldVoice, ctl, i, type Session } from '@ss/engine'
import { requestMotion, watchMotion } from '@ss/motion'
import { useOscTap, useSuperSonic } from '@ss/react'
import { EngineFooter, PageHeader, SourceFooter } from '@ss/ui'
import { audioSession, canSpeak, keepAwake, narrate, platformOf, unlockVoice, type Platform } from './device.ts'
import {
  needsFacilitator,
  noiseDb,
  progress,
  reduce,
  startFlow,
  toDb,
  tonePassed,
  type Flow,
  type FlowEvent,
  type Version,
} from './flow.ts'
import { groupFor, type Group } from './groups.ts'

/**
 * The phone onboarding test, both versions. See
 * `docs/Phone onboarding test spec.md` for what each screen must do and why;
 * `flow.ts` holds the order and the rules, this file the screens and sounds.
 *
 * Sound uses only what the repo already has: Sonic Pi's `pretty_bell` is the chime, and
 * `ssp_mic_follow` — the `/mic/` page's level follower — reports the
 * microphone's level for Version A. The narrator is the browser's own voice.
 */

/** The tone check's margin over the room. The spec says start at 15 and tune at rehearsal: `?margin=12`. */
const MARGIN_DB = (() => {
  const asked = Number(new URLSearchParams(location.search).get('margin'))
  return Number.isFinite(asked) && asked > 0 ? asked : 15
})()
/** How far over the room the narrator must lift the microphone to count as heard. */
const VOICE_MARGIN_DB = 10

/**
 * The check sound: Sonic Pi's `pretty_bell`, a soft chime that decays, vendored
 * with the engine. A held sine was the first version — a plain beep, which read
 * as an alarm. `measureMs` is how long after each chime its loudest moment is
 * looked for, which the bell's fast attack puts at the very start.
 */
const TONE = { note: 76, amp: 0.6, release: 1.2, everyMs: 1000, measureMs: 450 }
/** Pulses without a pass before the step counts a failed try and shows the fixes. */
const PULSES_PER_TRY = 8
/** A control bus nothing else on these pages reads; the follower must write somewhere. */
const UNUSED_BUS = 10
/** `shakeRaw` above this is a shake. */
const SHAKE = 0.3
const SHAKE_WINDOW_MS = 10_000

const CONSTRAINTS: MediaStreamConstraints = {
  // All off, per the spec: echo cancellation would remove the phone's own
  // tone, and automatic gain would hide how loud it really is.
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
}

function sessionStore(): Storage | null {
  try {
    return sessionStorage
  } catch {
    return null
  }
}

/** One chime. The bell frees itself when it has decayed. */
function pulse(engine: Session) {
  engine.sonic.send(
    '/s_new',
    'sonic-pi-pretty_bell',
    i(engine.sonic.nextNodeId()),
    i(0),
    i(0),
    ...ctl({ note: TONE.note, amp: TONE.amp, release: TONE.release }),
  )
}

export function Onboarding({ version }: { version: Version }) {
  const group = useMemo(() => groupFor(sessionStore()), [])
  const platform = useMemo(() => platformOf(navigator), [])
  const [flow, send] = useReducer(reduce, version, startFlow)
  const { status, boot, session } = useSuperSonic()
  const booted = status.phase === 'ready' || status.phase === 'degraded'

  // What a screen reader says when a step passes or fails.
  const [announcement, setAnnouncement] = useState('')

  // Version A's microphone, and the room's noise once measured.
  const stream = useRef<MediaStream | null>(null)
  const level = useRef(0)
  const room = useRef(-100)
  const [micOpen, setMicOpen] = useState(false)

  useOscTap(
    '/ssp_mic',
    (message) => {
      // SendReply sends [address, nodeId, replyId, level].
      if (typeof message[3] === 'number') level.current = message[3]
    },
    [booted, micOpen],
  )

  // The follower runs while the microphone is open and the engine is up.
  useEffect(() => {
    const engine = session()
    const granted = stream.current
    if (!booted || !engine || !micOpen || !granted) return
    const context = engine.sonic.audioContext
    const node = engine.sonic.node
    if (!context || !node) return
    const source = context.createMediaStreamSource(granted)
    source.connect(node.input)
    const follower = new HeldVoice({ session: engine, def: 'ssp_mic_follow', initial: { bus: UNUSED_BUS } })
    return () => {
      follower.dispose()
      source.disconnect()
    }
  }, [booted, session, micOpen])

  // Let the microphone go as soon as the sound checks are over: nothing after
  // them needs it, and an open mic is what moves iPhone audio to the earpiece.
  const closeMic = useCallback(() => {
    if (!stream.current) return
    stream.current.getTracks().forEach((track) => track.stop())
    stream.current = null
    setMicOpen(false)
    audioSession('playback')
  }, [])
  useEffect(() => {
    if (flow.step === 'motion' || flow.step === 'ready') closeMic()
  }, [flow.step, closeMic])
  useEffect(() => closeMic, [closeMic])

  const act = useCallback(
    (event: FlowEvent, said?: string) => {
      if (said) setAnnouncement(said)
      send(event)
    },
    [],
  )

  // Stable, because the tone's timer depends on it: a new function each render
  // would restart the pulse on every render.
  const engine = useCallback(() => (booted ? session() : null), [booted, session])

  const shared: StepProps = {
    flow,
    group,
    platform,
    act,
    engine,
    booted,
    level,
    room,
  }

  return (
    <main className="ak flex min-h-dvh flex-col text-base">
      <PageHeader title={version === 'A' ? 'onboard one' : 'onboard two'} />
      <GroupBand group={group} big={flow.step === 'ready'} />

      <div className="pad-safe-x mx-auto flex w-full max-w-md flex-1 flex-col gap-5 pt-6">
        {flow.step !== 'ready' ? (
          <p className="ak-label text-base" data-testid="progress">
            Step {progress(flow).at} of {progress(flow).of}
          </p>
        ) : null}

        {flow.step === 'start' ? (
          <Start
            {...shared}
            onStart={() => {
              // Playback from the first tap; Version A switches only while its
              // microphone is open.
              audioSession('playback')
              unlockVoice()
              boot()
            }}
          />
        ) : flow.step === 'speaker' ? (
          <Speaker {...shared} />
        ) : flow.step === 'volume' ? (
          <Volume {...shared} />
        ) : flow.step === 'mic' ? (
          <Mic
            {...shared}
            onGranted={(granted) => {
              stream.current = granted
              setMicOpen(true)
            }}
          />
        ) : flow.step === 'quiet' ? (
          <Quiet {...shared} />
        ) : flow.step === 'tone' ? (
          <ToneMeasured {...shared} />
        ) : flow.step === 'toneAsk' ? (
          <ToneAsked {...shared} />
        ) : flow.step === 'voice' ? (
          <Voice {...shared} measured />
        ) : flow.step === 'voiceAsk' ? (
          <Voice {...shared} measured={false} />
        ) : flow.step === 'motion' ? (
          <Motion {...shared} />
        ) : (
          <Ready {...shared} />
        )}

        {status.phase === 'failed' && flow.step !== 'start' && flow.step !== 'ready' ? (
          <p className="rounded border border-red-900 bg-red-950/40 p-3 text-base text-red-300">
            This browser could not start the sound engine, so there will be no tone. Choose
            &ldquo;Continue without sound&rdquo; to carry on.
          </p>
        ) : null}

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
        <div className="mt-auto" />
      </div>

      {/* Small and last: for a facilitator looking at a silent phone, not for
          the person onboarding. */}
      {booted ? <EngineFooter /> : null}
      <SourceFooter />
    </main>
  )
}

// ------------------------------------------------------------ the pieces

interface StepProps {
  flow: Flow
  group: Group
  platform: Platform
  act(event: FlowEvent, said?: string): void
  engine(): Session | null
  booted: boolean
  level: { current: number }
  room: { current: number }
}

function GroupBand({ group, big }: { group: Group; big: boolean }) {
  return (
    <div
      className={`flex items-center justify-center gap-3 text-black ${big ? 'py-12' : 'py-4'}`}
      style={{ backgroundColor: group.colour }}
      data-testid="group"
      data-group={group.index}
    >
      <Symbol group={group} size={big ? 72 : 32} />
      <span className={`font-semibold ${big ? 'text-4xl' : 'text-xl'}`}>{group.name}</span>
    </div>
  )
}

function Symbol({ group, size }: { group: Group; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {group.name === 'Circle' ? <circle cx="12" cy="12" r="10" /> : null}
      {group.name === 'Square' ? <rect x="2.5" y="2.5" width="19" height="19" /> : null}
      {group.name === 'Triangle' ? <path d="M12 2L22.5 21H1.5Z" /> : null}
    </svg>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return <h1 className="text-2xl font-semibold text-neutral-100">{children}</h1>
}

function Say({ children }: { children: ReactNode }) {
  return <p className="text-lg text-neutral-200">{children}</p>
}

function Primary({ children, onClick, disabled = false }: { children: ReactNode; onClick(): void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-14 rounded bg-[var(--ak-accent)] px-5 text-lg font-semibold text-black disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function Secondary({ children, onClick }: { children: ReactNode; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ak-panel min-h-12 rounded border px-4 text-base text-neutral-200"
    >
      {children}
    </button>
  )
}

function Tick({ children }: { children: ReactNode }) {
  return (
    <p className="text-xl font-semibold text-green-400" data-testid="tick">
      <span aria-hidden="true">✓ </span>
      {children}
    </p>
  )
}

/** Fixes for a failure, then — after two — the facilitator and a way on. */
function Fixes({ flow, lines, act, skipLabel }: { flow: Flow; lines: string[]; act: StepProps['act']; skipLabel: string }) {
  return (
    <div className="flex flex-col gap-3 rounded border border-amber-900 bg-amber-950/40 p-4" data-testid="fixes">
      <ul className="flex list-disc flex-col gap-2 pl-5 text-base text-amber-200">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {needsFacilitator(flow) ? (
        <div className="flex flex-col gap-2">
          <p className="text-lg font-semibold text-amber-200" data-testid="facilitator">
            Ask a facilitator
          </p>
          <Secondary onClick={() => act({ type: 'skip' }, 'Skipped')}>Continue without this</Secondary>
        </div>
      ) : (
        <Secondary onClick={() => act({ type: 'skip' }, 'Skipped')}>{skipLabel}</Secondary>
      )}
    </div>
  )
}

function soundFixes(platform: Platform, measured: boolean): string[] {
  const muted =
    platform === 'android'
      ? 'Press a volume button and raise the media volume.'
      : platform === 'ios'
        ? 'iPhone: flip the switch on the side so no orange shows. Then press the volume-up button.'
        : 'iPhone: flip the switch on the side so no orange shows, then press volume up. Android: raise the media volume.'
  return [
    muted,
    'Turn off Bluetooth, or take your headphones off and disconnect them.',
    measured ? 'Turn the volume up until the bar passes the line.' : 'Turn the volume up until it is clearly loud.',
    ...earpiece(platform, measured),
  ]
}

/**
 * The one fix for sound stuck in the earpiece. There is no switch for it: a
 * page cannot choose the speaker on iOS, and the person cannot either. A fresh
 * tab resets it; in Version A it only stays fixed without the microphone.
 */
function earpiece(platform: Platform, measured: boolean): string[] {
  if (platform === 'android') return []
  return [
    measured
      ? 'If the sound comes from the earpiece at the top, like a phone call: close this tab, open the link again, and choose “Continue without the microphone”.'
      : 'If the sound comes from the earpiece at the top, like a phone call: close this tab and open the link again.',
  ]
}

/** A tick, held long enough to be seen, then on. */
function usePass(act: StepProps['act'], label: string) {
  const [passed, setPassed] = useState(false)
  const pass = useCallback(() => {
    setPassed(true)
    setTimeout(() => act({ type: 'pass' }, `${label} passed`), 900)
  }, [act, label])
  return [passed, pass] as const
}

/** The tone pulsing once a second while `on`, calling `onPulse` with each start time. */
function usePulses(on: boolean, engine: StepProps['engine'], onPulse?: (at: number) => void) {
  const latest = useRef(onPulse)
  latest.current = onPulse
  useEffect(() => {
    if (!on) return
    const fire = () => {
      const live = engine()
      if (!live) return
      pulse(live)
      latest.current?.(performance.now())
    }
    fire()
    const timer = setInterval(fire, TONE.everyMs)
    return () => clearInterval(timer)
  }, [on, engine])
}

// ---------------------------------------------------------------- steps

function Start({ group, act, onStart }: StepProps & { onStart(): void }) {
  return (
    <>
      <Heading>Hello, {group.name}.</Heading>
      <Say>Let&rsquo;s get your phone ready. It takes about two minutes.</Say>
      <Primary
        onClick={() => {
          onStart()
          act({ type: 'next' })
        }}
      >
        Start
      </Primary>
    </>
  )
}

function Speaker({ platform, act }: StepProps) {
  return (
    <>
      <Heading>Put the sound on the speaker</Heading>
      <ul className="flex list-disc flex-col gap-3 pl-5 text-lg text-neutral-200">
        <li>Turn off Bluetooth and unplug any headphones.</li>
        {platform !== 'android' ? <li>iPhone: switch silent mode off.</li> : null}
        {platform === 'android' ? (
          <li>Press a volume button and check the media volume.</li>
        ) : (
          <li>Hold the phone with the screen facing you: the sound should come from the bottom edge, not the earpiece at the top.</li>
        )}
      </ul>
      <Primary onClick={() => act({ type: 'next' })}>Next</Primary>
    </>
  )
}

/**
 * Volume up, all the way. No web API can read or set the phone's volume — on
 * iOS a page always reads it as full — so the page plays the chime and asks.
 * The chime matters: on iPhone the volume buttons only change media volume
 * while the page is making sound.
 */
function Volume({ platform, act, engine, booted }: StepProps) {
  usePulses(booted, engine)
  return (
    <>
      <Heading>Turn the volume up full</Heading>
      <Say>You&rsquo;ll hear a soft chime.</Say>
      <ul className="flex list-disc flex-col gap-3 pl-5 text-lg text-neutral-200">
        <li>
          {platform === 'android'
            ? 'Press the volume-up button until the media volume is at the top.'
            : 'Press the volume-up button on the side until it will not go any higher.'}
        </li>
        <li>The chime should come from the bottom edge of the phone, not the earpiece at the top.</li>
      </ul>
      <Primary onClick={() => act({ type: 'next' }, 'Volume set')}>Volume is full</Primary>
    </>
  )
}

function Mic({ flow, act, onGranted }: StepProps & { onGranted(stream: MediaStream): void }) {
  const [refused, setRefused] = useState(false)

  const ask = () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setRefused(true)
      return
    }
    // Before the microphone opens, as the WebKit workaround has it.
    audioSession('play-and-record')
    navigator.mediaDevices.getUserMedia(CONSTRAINTS).then(
      (granted) => {
        onGranted(granted)
        act({ type: 'next' }, 'Microphone allowed')
      },
      () => {
        audioSession('playback')
        setRefused(true)
        act({ type: 'fail' }, 'Microphone not allowed')
      },
    )
  }

  return (
    <>
      <Heading>Allow the microphone</Heading>
      <Say>
        To check your speaker is loud enough, the page listens for a short sound that it plays
        itself. It keeps only the loudness, nothing is recorded or sent.
      </Say>
      {refused ? (
        <div className="flex flex-col gap-3 rounded border border-amber-900 bg-amber-950/40 p-4" data-testid="fixes">
          <p className="text-base text-amber-200">
            No problem. If no prompt appeared, the microphone may be blocked: open the page&rsquo;s
            site settings and allow it, or continue without it.
          </p>
          {needsFacilitator(flow) ? (
            <p className="text-lg font-semibold text-amber-200">Ask a facilitator</p>
          ) : null}
          <Primary onClick={() => act({ type: 'micRefused' }, 'Continuing without the microphone')}>
            Continue without the microphone
          </Primary>
          <Secondary onClick={ask}>Try the microphone again</Secondary>
        </div>
      ) : (
        <Primary onClick={ask}>Allow microphone</Primary>
      )}
    </>
  )
}

function Quiet({ act, level, room }: StepProps) {
  useEffect(() => {
    const readings: number[] = []
    const sampling = setInterval(() => readings.push(toDb(level.current)), 50)
    const done = setTimeout(() => {
      clearInterval(sampling)
      room.current = noiseDb(readings)
      act({ type: 'next' }, 'Room measured')
    }, 2000)
    return () => {
      clearInterval(sampling)
      clearTimeout(done)
    }
  }, [act, level, room])

  return (
    <>
      <Heading>Quiet first</Heading>
      <Say>Stay quiet for a moment.</Say>
      <p className="ss-waiting ak-panel rounded border p-3 text-base">Listening to the room…</p>
    </>
  )
}

function ToneMeasured({ flow, platform, act, engine, booted, level, room }: StepProps) {
  const [passed, pass] = usePass(act, 'Sound')
  const peaks = useRef<number[]>([])
  const sinceTry = useRef(0)

  // After each pulse, its loudest reading while it sounded.
  usePulses(booted && !passed, engine, () => {
    let loudest = -100
    const watching = setInterval(() => (loudest = Math.max(loudest, toDb(level.current))), 25)
    setTimeout(() => {
      clearInterval(watching)
      peaks.current.push(loudest)
      if (tonePassed(peaks.current, room.current, MARGIN_DB)) {
        pass()
        return
      }
      sinceTry.current += 1
      if (sinceTry.current >= PULSES_PER_TRY) {
        sinceTry.current = 0
        act({ type: 'fail' }, 'Not loud enough yet')
      }
    }, TONE.measureMs)
  })

  // The bar, per frame: the level over the room, with the line at the margin.
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let frame = 0
    const span = MARGIN_DB * 1.6
    const draw = () => {
      const over = toDb(level.current) - room.current
      if (bar.current) bar.current.style.width = `${Math.max(0, Math.min(1, over / span)) * 100}%`
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [level, room])

  return (
    <>
      <Heading>Tone check</Heading>
      <Say>You&rsquo;ll hear a soft pulsing tone. Turn your volume up until the bar passes the line.</Say>
      <div className="ak-panel relative h-10 overflow-hidden rounded border" aria-hidden="true">
        <div ref={bar} className="h-full bg-[var(--ak-accent)]" style={{ width: '0%' }} data-testid="tone-bar" />
        <div className="absolute top-0 h-full w-1 bg-white" style={{ left: `${(1 / 1.6) * 100}%` }} />
      </div>
      {passed ? <Tick>Loud enough</Tick> : null}
      {!passed && flow.tries > 0 ? (
        <Fixes flow={flow} lines={soundFixes(platform, true)} act={act} skipLabel="Continue without sound" />
      ) : null}
      {!passed && flow.tries === 0 ? (
        <Secondary onClick={() => act({ type: 'skip' }, 'Skipped')}>Continue without sound</Secondary>
      ) : null}
    </>
  )
}

function ToneAsked({ flow, platform, act, engine, booted }: StepProps) {
  const [playing, setPlaying] = useState(false)
  const [passed, pass] = usePass(act, 'Sound')
  usePulses(booted && playing && !passed, engine)

  return (
    <>
      <Heading>Tone check</Heading>
      <Say>
        Press Play. You&rsquo;ll hear a soft tone. Hold your phone at arm&rsquo;s length: can you
        hear it clearly from the phone&rsquo;s speaker, not from headphones?
      </Say>
      {passed ? (
        <Tick>Sound is on the speaker</Tick>
      ) : !playing ? (
        <Primary onClick={() => setPlaying(true)}>Play</Primary>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Primary
            onClick={() => {
              setPlaying(false)
              pass()
            }}
          >
            Yes, I hear it
          </Primary>
          <Secondary
            onClick={() => {
              setPlaying(false)
              act({ type: 'fail' }, 'Not heard')
            }}
          >
            No
          </Secondary>
        </div>
      )}
      {!passed && flow.tries > 0 ? (
        <Fixes flow={flow} lines={soundFixes(platform, false)} act={act} skipLabel="Continue without sound" />
      ) : null}
      {!passed && flow.tries === 0 ? (
        <Secondary onClick={() => act({ type: 'skip' }, 'Skipped')}>Continue without sound</Secondary>
      ) : null}
    </>
  )
}

/**
 * The narrator. Measured (A): it plays on arrival, and passes if the
 * microphone rose over the room while it spoke — otherwise, or if the phone
 * has no voice at all, it falls back to asking. Asked (B): Play, then Yes or No.
 */
function Voice({ flow, platform, act, level, room, measured }: StepProps & { measured: boolean }) {
  const [passed, pass] = usePass(act, 'Voice')
  const [asking, setAsking] = useState(!measured)
  const [played, setPlayed] = useState(false)

  const play = useCallback(() => {
    setPlayed(true)
    if (!canSpeak()) {
      setAsking(true)
      return
    }
    let loudest = -100
    let watching: ReturnType<typeof setInterval> | null = null
    // A voice that never starts is a phone with no speech, or a muted one.
    const silent = setTimeout(() => setAsking(true), 5000)
    narrate('Hello. This is the narrator.', {
      onStart: () => {
        clearTimeout(silent)
        watching = setInterval(() => (loudest = Math.max(loudest, toDb(level.current))), 25)
      },
      onEnd: () => {
        clearTimeout(silent)
        if (watching) clearInterval(watching)
        if (!measured) return
        if (loudest - room.current >= VOICE_MARGIN_DB) pass()
        else setAsking(true)
      },
    })
  }, [level, room, measured, pass])

  useEffect(() => {
    if (measured) play()
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <Heading>Voice check</Heading>
      <Say>
        {measured
          ? 'Now you’ll hear the narrator.'
          : 'Press Play. You’ll hear the narrator say hello. Did you hear a voice from the speaker?'}
      </Say>
      {passed ? (
        <Tick>Voice heard</Tick>
      ) : !asking ? (
        <p className="ss-waiting ak-panel rounded border p-3 text-base">Listening for the narrator…</p>
      ) : (
        <>
          {measured ? <Say>Did you hear a voice?</Say> : null}
          {!played && !measured ? (
            <Primary onClick={play}>Play</Primary>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Primary onClick={pass}>Yes</Primary>
              <Secondary onClick={() => act({ type: 'fail' }, 'Voice not heard')}>No</Secondary>
            </div>
          )}
          {flow.tries > 0 ? (
            <>
              <Secondary onClick={play}>Play again</Secondary>
              <Fixes
                flow={flow}
                lines={['Turn the volume up and press Play again.', ...earpiece(platform, measured)]}
                act={act}
                skipLabel="Continue without the voice"
              />
            </>
          ) : (
            <Secondary onClick={() => act({ type: 'skip' }, 'Skipped')}>Continue without the voice</Secondary>
          )}
        </>
      )}
    </>
  )
}

function Motion({ flow, group, act }: StepProps) {
  const [watching, setWatching] = useState(false)
  const [passed, pass] = usePass(act, 'Motion')
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (!watching || passed) return
    const stop = watchMotion({
      onMotion: (motion) => {
        if (motion.shakeRaw < SHAKE) return
        // One flash, once: well under three a second.
        setFlash(true)
        setTimeout(() => setFlash(false), 400)
        setWatching(false)
        pass()
      },
    })
    const timeout = setTimeout(() => {
      setWatching(false)
      act({ type: 'fail' }, 'No movement felt')
    }, SHAKE_WINDOW_MS)
    return () => {
      stop()
      clearTimeout(timeout)
    }
  }, [watching, passed, pass, act])

  const allow = () => {
    // From the tap: iOS only shows the motion prompt for one.
    void requestMotion().then((permission) => {
      if (permission === 'denied') act({ type: 'fail' }, 'Motion not allowed')
      else setWatching(true)
    })
  }

  return (
    <>
      {flash ? (
        <div className="pointer-events-none fixed inset-0 z-50" style={{ backgroundColor: group.colour }} data-testid="flash" />
      ) : null}
      <Heading>Allow motion, then shake</Heading>
      <Say>{watching ? 'Shake your phone gently.' : 'Next, your phone feels movement.'}</Say>
      {passed ? (
        <Tick>Movement felt</Tick>
      ) : watching ? (
        <p className="ss-waiting ak-panel rounded border p-3 text-base">Waiting for a shake…</p>
      ) : (
        <Primary onClick={allow}>Allow motion</Primary>
      )}
      {!passed && flow.tries > 0 ? (
        <Fixes
          flow={flow}
          lines={['Tap Allow motion again. If nothing appears, check the browser’s site settings.']}
          act={act}
          skipLabel="Skip movement"
        />
      ) : null}
      {!passed && flow.tries === 0 ? (
        <Secondary onClick={() => act({ type: 'skip' }, 'Skipped')}>Skip movement</Secondary>
      ) : null}
    </>
  )
}

function Ready({ flow }: StepProps) {
  const [awake, setAwake] = useState<boolean | null>(null)
  useEffect(() => keepAwake(setAwake), [])

  const row = (name: string, outcome: string | null) => (
    <li className="flex justify-between border-b border-[var(--ak-line)] py-2 text-lg" key={name}>
      <span>{name}</span>
      <span className={outcome === 'passed' ? 'text-green-400' : 'text-neutral-400'} data-testid={`result-${name}`}>
        {outcome === 'passed' ? '✓ Passed' : 'Skipped'}
      </span>
    </li>
  )

  return (
    <>
      <Heading>
        <span aria-hidden="true" className="text-green-400">
          ✓{' '}
        </span>
        You&rsquo;re ready.
      </Heading>
      <ul data-testid="results">
        {row('Sound', flow.results.sound)}
        {row('Voice', flow.results.voice)}
        {row('Motion', flow.results.motion)}
      </ul>
      <Say>Keep this screen open and your phone awake.</Say>
      {awake === false ? (
        <p className="ak-label text-base">
          This browser could not keep the screen on by itself: tap the screen now and then.
        </p>
      ) : null}
    </>
  )
}
