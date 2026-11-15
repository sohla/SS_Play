import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { HeldVoice, ctl, i, type Session } from '@ss/engine'
import { requestMotion, watchMotion } from '@ss/motion'
import { useOscTap, useSuperSonic } from '@ss/react'
import { EngineFooter, PageHeader, SourceFooter } from '@ss/ui'
import { audioSession, hush, keepAwake, platformOf, unlockVoice } from './device.ts'
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
import {
  HearAgain,
  NarrationStyles,
  NarratorContext,
  NarratorToggle,
  useNarration,
  type Narration,
} from './narration.tsx'
import { resolve, type Resolved, type Script } from './cues.ts'
import { instruments, pulseEvery, scripts, tempo } from './score.ts'

/**
 * The phone onboarding test, both versions. See
 * `docs/Phone onboarding test spec.md` for what each screen must do and why.
 * `score.ts` holds what is said and played, when, and in what order; `flow.ts`
 * the rules; this file the screens, the checks and the buttons.
 *
 * `ssp_mic_follow` — the `/mic/` page's level follower — reports the
 * microphone's level for Version A. The narrator is the browser's own voice —
 * see `narration.tsx`.
 */

/** The tone check's margin over the room. The spec says start at 15 and tune at rehearsal: `?margin=12`. */
const MARGIN_DB = (() => {
  const asked = Number(new URLSearchParams(location.search).get('margin'))
  return Number.isFinite(asked) && asked > 0 ? asked : 15
})()
/** How far over the room the narrator must lift the microphone to count as heard. */
const VOICE_MARGIN_DB = 10

/**
 * How long after each pulse of the score's `tone` its loudest moment is looked
 * for, which the bell's fast attack puts at the very start.
 */
const MEASURE_MS = 450
const PULSE_MS = (pulseEvery * 60_000) / tempo
/** Pulses without a pass before the step counts a failed try and shows the fixes. */
const PULSES_PER_TRY = 8
/** A control bus nothing else on these pages reads; the follower must write somewhere. */
const UNUSED_BUS = 10
/** `shakeRaw` above this is a shake. */
const SHAKE = 0.3
const SHAKE_WINDOW_MS = 10_000
const NARRATOR_KEY = 'ss-onboard-narrator'

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

/** One note of a score instrument. Its SynthDef must free itself, as the bells do. */
function sound(engine: Session, name: string, args?: Record<string, number>) {
  const instrument = instruments[name]
  if (!instrument) {
    console.warn(`score: no instrument "${name}"`)
    return
  }
  engine.sonic.send(
    '/s_new',
    instrument.def,
    i(engine.sonic.nextNodeId()),
    i(0),
    i(0),
    ...ctl({ ...instrument.args, ...args }),
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

  // The narrator: on unless the person turns it off, and silent until the
  // Start tap has unlocked speech on iOS.
  const [narratorOn, setNarratorOn] = useState(() => {
    try {
      return sessionStorage.getItem(NARRATOR_KEY) !== 'off'
    } catch {
      return true
    }
  })
  const [unlocked, setUnlocked] = useState(false)
  const toggleNarrator = (on: boolean) => {
    setNarratorOn(on)
    if (!on) hush()
    try {
      sessionStorage.setItem(NARRATOR_KEY, on ? 'on' : 'off')
    } catch {
      // Not remembered, then.
    }
  }

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

  const narrator = useMemo(
    () => ({
      on: narratorOn,
      unlocked,
      play: (name: string, args?: Record<string, number>) => {
        const live = engine()
        if (live) sound(live, name, args)
      },
    }),
    [narratorOn, unlocked, engine],
  )

  const lines = useCallback((script: Script) => resolve(script, platform, group.name), [platform, group])

  const shared: StepProps = {
    lines,
    flow,
    group,
    act,
    engine,
    booted,
    level,
    room,
  }

  return (
    <NarratorContext.Provider value={narrator}>
    <main
      className="ak flex min-h-dvh flex-col text-base"
      style={{ '--group': group.colour } as CSSProperties}
    >
      <NarrationStyles />
      <PageHeader title={version === 'A' ? 'onboard one' : 'onboard two'} />
      <GroupBand group={group} big={flow.step === 'ready'} />

      <div className="pad-safe-x mx-auto flex w-full max-w-md flex-1 flex-col gap-5 pt-6">
        <div className="flex items-center justify-between gap-3">
          {flow.step !== 'ready' ? (
            <p className="ak-label text-base" data-testid="progress">
              Step {progress(flow).at} of {progress(flow).of}
            </p>
          ) : (
            <span />
          )}
          <NarratorToggle on={narratorOn} onChange={toggleNarrator} />
        </div>

        {/* A fresh screen gets fresh state, and its own narration. */}
        <div key={flow.step} className="flex flex-col gap-5">

        {flow.step === 'start' ? (
          <Start
            {...shared}
            onStart={() => {
              // Playback from the first tap; Version A switches only while its
              // microphone is open.
              audioSession('playback')
              unlockVoice()
              setUnlocked(true)
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
        </div>

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
    </NarratorContext.Provider>
  )
}

// ------------------------------------------------------------ the pieces

interface StepProps {
  /** A script from the score, for this phone and this person. */
  lines(script: Script): Resolved[]
  flow: Flow
  group: Group
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

/** A screen's words, spoken and lit, with "Hear again" under them. */
function Script({ narration }: { narration: Narration }) {
  return (
    <>
      {narration.view}
      <HearAgain narration={narration} />
    </>
  )
}

function Primary({ children, onClick, disabled = false }: { children: ReactNode; onClick(): void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-14 rounded bg-[var(--ak-accent)] px-5 text-lg font-semibold text-black transition-transform active:scale-95 disabled:opacity-40"
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
      className="ak-panel min-h-12 rounded border px-4 text-base text-neutral-200 transition-transform active:scale-95"
    >
      {children}
    </button>
  )
}

function Tick({ children }: { children: ReactNode }) {
  return (
    <p className="text-xl font-semibold text-green-400" data-testid="tick">
      <span aria-hidden="true" className="inline-block motion-safe:animate-bounce">
        ✓{' '}
      </span>
      {children}
    </p>
  )
}

/** Fixes for a failure, read aloud too, then — after two — the facilitator and a way on. */
function Fixes({ flow, script, act, skipLabel }: { flow: Flow; script: Resolved[]; act: StepProps['act']; skipLabel: string }) {
  const narration = useNarration(script)
  return (
    <div className="flex flex-col gap-3 rounded border border-amber-900 bg-amber-950/40 p-4" data-testid="fixes">
      {narration.view}
      <HearAgain narration={narration} />
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

/** A tick, held long enough to be seen, then on. */
function usePass(act: StepProps['act'], label: string) {
  const [passed, setPassed] = useState(false)
  const pass = useCallback(() => {
    setPassed(true)
    setTimeout(() => act({ type: 'pass' }, `${label} passed`), 900)
  }, [act, label])
  return [passed, pass] as const
}

/** The score's `tone`, every `pulseEvery` beats while `on`, calling `onPulse` with each start time. */
function usePulses(on: boolean, engine: StepProps['engine'], onPulse?: (at: number) => void) {
  const latest = useRef(onPulse)
  latest.current = onPulse
  useEffect(() => {
    if (!on) return
    const fire = () => {
      const live = engine()
      if (!live) return
      sound(live, 'tone')
      latest.current?.(performance.now())
    }
    fire()
    const timer = setInterval(fire, PULSE_MS)
    return () => clearInterval(timer)
  }, [on, engine])
}

// ---------------------------------------------------------------- steps

function Start({ lines, act, onStart }: StepProps & { onStart(): void }) {
  // Before the tap nothing can speak on iPhone, so this one is only read.
  const narration = useNarration(lines(scripts.start))
  return (
    <>
      {narration.view}
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

function Speaker({ lines, act }: StepProps) {
  const narration = useNarration(lines(scripts.speaker))
  return (
    <>
      <Script narration={narration} />
      <Primary onClick={() => act({ type: 'next' })}>Next</Primary>
    </>
  )
}

/**
 * Volume up, all the way. No web API can read or set the phone's volume — on
 * iOS a page always reads it as full — so the page plays the chime and asks.
 * The chime matters: on iPhone the volume buttons only change media volume
 * while the page is making sound. It starts once the narrator has finished, so
 * the two are not heard on top of each other.
 */
function Volume({ lines, act, engine, booted }: StepProps) {
  const narration = useNarration(lines(scripts.volume))
  usePulses(booted && narration.done && !narration.speaking, engine)
  return (
    <>
      <Script narration={narration} />
      <Primary onClick={() => act({ type: 'next' }, 'Volume set')}>Volume is full</Primary>
    </>
  )
}

function Mic({ lines, flow, act, onGranted }: StepProps & { onGranted(stream: MediaStream): void }) {
  const [refused, setRefused] = useState(false)
  const narration = useNarration(lines(scripts.mic))
  const refusal = useNarration(lines(scripts.micRefused), { auto: refused })

  const ask = () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setRefused(true)
      return
    }
    hush()
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
      <Script narration={narration} />
      {refused ? (
        <div className="flex flex-col gap-3 rounded border border-amber-900 bg-amber-950/40 p-4" data-testid="fixes">
          {refusal.view}
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

/**
 * The room's noise, measured once the narrator has stopped talking — measured
 * during "stay quiet", the narrator would be the room, and the tone could
 * never clear it.
 */
function Quiet({ lines, act, level, room }: StepProps) {
  const narration = useNarration(lines(scripts.quiet))
  const ready = narration.done && !narration.speaking

  useEffect(() => {
    if (!ready) return
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
  }, [ready, act, level, room])

  return (
    <>
      {narration.view}
      <p className="ss-waiting ak-panel rounded border p-3 text-base">
        {ready ? 'Listening to the room…' : 'Getting ready to listen…'}
      </p>
    </>
  )
}

function ToneMeasured({ lines, flow, act, engine, booted, level, room }: StepProps) {
  const [passed, pass] = usePass(act, 'Sound')
  const peaks = useRef<number[]>([])
  const sinceTry = useRef(0)
  const narration = useNarration(lines(scripts.tone))

  // After each chime, its loudest reading — only once the narrator is quiet,
  // or the voice would pass the check for it.
  usePulses(booted && !passed && narration.done && !narration.speaking, engine, () => {
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
    }, MEASURE_MS)
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
      <Script narration={narration} />
      <div className="ak-panel relative h-10 overflow-hidden rounded border" aria-hidden="true">
        <div ref={bar} className="h-full bg-[var(--group)]" style={{ width: '0%' }} data-testid="tone-bar" />
        <div className="absolute top-0 h-full w-1 bg-white" style={{ left: `${(1 / 1.6) * 100}%` }} />
      </div>
      {passed ? <Tick>Loud enough</Tick> : null}
      {!passed && flow.tries > 0 ? (
        <Fixes flow={flow} script={lines(scripts.fixes.soundMeasured)} act={act} skipLabel="Continue without sound" />
      ) : null}
      {!passed && flow.tries === 0 ? (
        <Secondary onClick={() => act({ type: 'skip' }, 'Skipped')}>Continue without sound</Secondary>
      ) : null}
    </>
  )
}

function ToneAsked({ lines, flow, act, engine, booted }: StepProps) {
  const [playing, setPlaying] = useState(false)
  const [passed, pass] = usePass(act, 'Sound')
  const narration = useNarration(lines(scripts.toneAsk))
  usePulses(booted && playing && !passed, engine)

  return (
    <>
      <Script narration={narration} />
      {passed ? (
        <Tick>Sound is on the speaker</Tick>
      ) : !playing ? (
        <Primary
          onClick={() => {
            hush()
            setPlaying(true)
          }}
        >
          Play
        </Primary>
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
        <Fixes flow={flow} script={lines(scripts.fixes.sound)} act={act} skipLabel="Continue without sound" />
      ) : null}
      {!passed && flow.tries === 0 ? (
        <Secondary onClick={() => act({ type: 'skip' }, 'Skipped')}>Continue without sound</Secondary>
      ) : null}
    </>
  )
}

/**
 * The voice check, where the narrator is the test.
 *
 * Measured (A): the screen reads itself and then says the line, and passes if
 * the microphone rose over the room while it spoke — otherwise, or if the
 * phone has no voice at all, it asks. It speaks even with the narrator off,
 * because without speech there is nothing to check.
 *
 * Asked (B): the screen reads its instructions; Play says the line, lit word
 * by word; then Yes or No.
 */
function Voice({ lines, flow, act, level, room, measured }: StepProps & { measured: boolean }) {
  const [passed, pass] = usePass(act, 'Voice')
  const [asking, setAsking] = useState(!measured)
  const loudest = useRef(-100)
  const watching = useRef<ReturnType<typeof setInterval> | null>(null)

  const listen = {
    onStart: () => {
      loudest.current = -100
      watching.current = setInterval(() => (loudest.current = Math.max(loudest.current, toDb(level.current))), 25)
    },
    onEnd: (heard: boolean) => {
      if (watching.current) clearInterval(watching.current)
      if (!measured) return
      if (heard && loudest.current - room.current >= VOICE_MARGIN_DB) pass()
      else setAsking(true)
    },
  }
  useEffect(() => () => void (watching.current && clearInterval(watching.current)), [])

  // Measured, the line follows the instructions by itself, and the microphone
  // listens to it alone.
  const instructions = useNarration(lines(measured ? scripts.voice : scripts.voiceAsk), measured ? { always: true } : {})
  const line = useNarration(lines(scripts.voiceLine), {
    auto: measured && instructions.done,
    always: true,
    ...(measured ? listen : {}),
  })
  const [played, setPlayed] = useState(false)
  const play = () => {
    setPlayed(true)
    line.play()
  }

  return (
    <>
      {instructions.view}
      {measured || played ? line.view : null}
      {passed ? (
        <Tick>Voice heard</Tick>
      ) : !asking ? (
        <p className="ss-waiting ak-panel rounded border p-3 text-base">Listening for the narrator…</p>
      ) : (
        <>
          {measured ? <p className="text-lg text-neutral-200">Did you hear a voice?</p> : null}
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
                script={lines(measured ? scripts.fixes.voiceMeasured : scripts.fixes.voice)}
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

function Motion({ lines, flow, group, act }: StepProps) {
  const [watching, setWatching] = useState(false)
  const [passed, pass] = usePass(act, 'Motion')
  const [flash, setFlash] = useState(false)
  // The words change once motion is allowed, and the new ones are read out.
  const narration = useNarration(lines(watching ? scripts.motionWatching : scripts.motion))

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
      <Script narration={narration} />
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
          script={lines(scripts.fixes.motion)}
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

function Ready({ lines, flow }: StepProps) {
  const [awake, setAwake] = useState<boolean | null>(null)
  useEffect(() => keepAwake(setAwake), [])
  const narration = useNarration(lines(scripts.ready))

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
      <p aria-hidden="true" className="text-5xl text-green-400 motion-safe:animate-bounce">
        ✓
      </p>
      <Script narration={narration} />
      <ul data-testid="results">
        {row('Sound', flow.results.sound)}
        {row('Voice', flow.results.voice)}
        {row('Motion', flow.results.motion)}
      </ul>
      {awake === false ? (
        <p className="ak-label text-base">
          This browser could not keep the screen on by itself: tap the screen now and then.
        </p>
      ) : null}
    </>
  )
}
