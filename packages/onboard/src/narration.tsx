import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { say, supported } from '@ss/speech'
import type { Resolved } from './cues.ts'
import { voice as script } from './score.ts'
import { wordsOf, type Part } from './words.ts'

/**
 * Every screen reads itself aloud, a line at a time, with the script's sound
 * after each line and a pause before the next.
 *
 * The voice is `@ss/speech`, the `/speak/` page's — the mechanics proven on
 * the phone: each line is queued with `say()`, the browser speaks it, and the
 * sounds are played from its hooks, as `/speak/` plays its bells. Nothing ever
 * cancels a line: a screen that is left simply queues nothing more. A word
 * lights only when the voice reports it; a voice that reports none lights none.
 *
 * Accessibility:
 *
 * - Screen readers get each line whole; the animated words are hidden from them.
 * - The narrator can be switched off — a VoiceOver or TalkBack user would
 *   otherwise hear two voices at once — and that choice lasts the session.
 * - With reduced motion asked for, the word changes colour and does not grow.
 * - Nothing is only spoken: every word is on the screen first.
 */

interface Narrator {
  /** Whether screens read themselves aloud. The person can turn it off. */
  on: boolean
  /** False until the Start tap: iOS will not speak before a gesture. */
  unlocked: boolean
  voice: SpeechSynthesisVoice | null
  /** Sound one of the script's instruments; a no-op until the engine is up. */
  play(instrument: string, args?: Record<string, number>): void
}

export const NarratorContext = createContext<Narrator>({ on: true, unlocked: false, voice: null, play: () => {} })

/**
 * How long a line's voice may take to start before the screen goes on without
 * it, so a phone that cannot speak still reaches its buttons.
 */
const NO_VOICE_MS = 4000

export interface NarrationOptions {
  /** Play when the screen appears. */
  auto?: boolean
  /** Play even with the narrator off — for the voice check, where the voice is the test. */
  always?: boolean
  onStart?(): void
  /** `heard` is false when the voice never started. */
  onEnd?(heard: boolean): void
}

export interface Narration {
  play(): void
  speaking: boolean
  /** True once the screen's lines, sounds and pauses are all done, or were never going to play. */
  done: boolean
  view: ReactNode
}

export function useNarration(lines: readonly Resolved[], options: NarrationOptions = {}): Narration {
  const { auto = true, always = false } = options
  const narrator = useContext(NarratorContext)
  const { on, unlocked } = narrator
  const key = JSON.stringify(lines)
  // `lines` is a fresh array each render; `key` is what actually identifies it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const kept = useMemo(() => lines, [key])
  const parts = useMemo(() => kept.map((line): Part => ({ kind: line.as, text: line.text })), [kept])
  const { words } = useMemo(() => wordsOf(parts), [parts])

  const [current, setCurrent] = useState(-1)
  const [reached, setReached] = useState(-1)
  const [speaking, setSpeaking] = useState(false)
  const [done, setDone] = useState(false)

  const hooks = useRef(options)
  hooks.current = options
  const live = useRef(narrator)
  live.current = narrator
  /** Bumped on every play and on leaving, so an abandoned run queues nothing more. */
  const run = useRef(0)

  const play = useCallback(() => {
    const token = ++run.current
    const mine = () => token === run.current
    let heard = false
    setDone(false)
    setCurrent(-1)
    setReached(-1)

    const finish = () => {
      if (!mine()) return
      setSpeaking(false)
      setCurrent(-1)
      setDone(true)
      hooks.current.onEnd?.(heard)
    }
    if (!supported()) return finish()
    setSpeaking(true)

    const light = (n: number) => {
      setCurrent(n)
      setReached((was) => Math.max(was, n))
    }

    const next = (index: number) => {
      if (!mine()) return
      const line = kept[index]
      if (!line) return finish()
      const ids = words.flatMap((word, n) => (word.part === index ? [n] : []))
      let started = false
      const silent = setTimeout(() => !started && finish(), NO_VOICE_MS)
      const after = () => {
        if (!mine()) return
        setCurrent(-1)
        if (line.play) live.current.play(line.play, line.args)
        setTimeout(() => next(index + 1), line.pause * 1000)
      }

      say(
        line.text,
        live.current.voice,
        {
          onStart: () => {
            started = true
            clearTimeout(silent)
            if (!mine()) return
            if (!heard) hooks.current.onStart?.()
            heard = true
          },
          onWord: (_word, n) => {
            if (!mine()) return
            light(ids[Math.min(n, ids.length - 1)]!)
            if (script.word) live.current.play(script.word)
          },
          onEnd: after,
          onError: after,
        },
        script.rate,
      )
    }
    next(0)
  }, [kept, words])

  // Play on arrival, if this screen should — otherwise it is done already.
  useEffect(() => {
    if (auto && unlocked && (on || always)) play()
    else {
      run.current += 1
      setSpeaking(false)
      setCurrent(-1)
      setDone(true)
    }
    return () => {
      run.current += 1
    }
  }, [auto, unlocked, on, always, play])

  const view = <Spoken parts={parts} words={words} current={current} reached={speaking ? reached : Infinity} />
  return { play, speaking, done, view }
}

const SIZE: Record<Part['kind'], string> = {
  heading: 'text-2xl font-semibold text-neutral-100',
  say: 'text-lg text-neutral-200',
  item: 'text-lg text-neutral-200',
  quote: 'text-2xl font-semibold italic text-neutral-100',
}

function Spoken({
  parts,
  words,
  current,
  reached,
}: {
  parts: readonly Part[]
  words: ReturnType<typeof wordsOf>['words']
  current: number
  /** The furthest word said so far; words past it are dimmed. */
  reached: number
}) {
  const drawn = (index: number) => {
    const mine = words.map((word, n) => ({ word, n })).filter(({ word }) => word.part === index)
    return (
      <>
        <span className="sr-only">{parts[index]!.text}</span>
        <span aria-hidden="true">
          {mine.map(({ word, n }, k) => (
            <span key={n}>
              {k > 0 ? ' ' : null}
              <span
                data-word={n}
                data-current={n === current ? 'yes' : undefined}
                className={[
                  // Every word carries a little padding of its own, so the pill has
                  // room to fill when it lights and nothing reflows as it moves.
                  'inline-block rounded-md px-[0.12em] transition-[transform,background-color,color,opacity] duration-200',
                  'ease-[cubic-bezier(0.34,1.56,0.64,1)]',
                  n === current
                    ? // Grows a tenth and lifts: enough to feel alive, not enough to
                      // swallow the space either side, which 1.18 with a ring did.
                      'relative z-10 bg-[var(--group)] text-black motion-safe:-translate-y-0.5 motion-safe:scale-110'
                    : n > reached
                      ? 'opacity-55'
                      : '',
                ].join(' ')}
              >
                {word.text}
              </span>
            </span>
          ))}
        </span>
      </>
    )
  }

  // Consecutive items are one list.
  const out: ReactNode[] = []
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!
    if (part.kind === 'item') {
      const items: number[] = []
      while (parts[index]?.kind === 'item') items.push(index++)
      index -= 1
      out.push(
        <ul key={index} className="flex list-disc flex-col gap-3 pl-5">
          {items.map((at) => (
            <li key={at} className={SIZE.item}>
              {drawn(at)}
            </li>
          ))}
        </ul>,
      )
    } else if (part.kind === 'heading') {
      out.push(
        <h1 key={index} className={SIZE.heading}>
          {drawn(index)}
        </h1>,
      )
    } else if (part.kind === 'quote') {
      out.push(
        <blockquote key={index} className={`${SIZE.quote} border-l-4 border-[var(--group)] pl-4`}>
          {drawn(index)}
        </blockquote>,
      )
    } else {
      out.push(
        <p key={index} className={SIZE.say}>
          {drawn(index)}
        </p>,
      )
    }
  }
  return <>{out}</>
}

/**
 * "Hear again", and a little set of bars that dance while the narrator talks.
 * Secondary on purpose: the screen's one real action stays the big button.
 */
export function HearAgain({ narration }: { narration: Narration }) {
  return (
    <button
      type="button"
      onClick={narration.play}
      disabled={narration.speaking}
      className="ak-label flex min-h-11 items-center gap-2 self-start rounded px-1 text-base underline-offset-4 hover:underline"
      data-testid="hear-again"
    >
      <Bars active={narration.speaking} />
      {narration.speaking ? 'Speaking…' : 'Hear again'}
    </button>
  )
}

function Bars({ active }: { active: boolean }) {
  return (
    <span aria-hidden="true" className="flex h-5 items-end gap-[3px]">
      {[0, 1, 2, 3].map((n) => (
        <span
          key={n}
          className="w-[3px] rounded-full bg-[var(--group)]"
          style={{
            height: active ? undefined : '35%',
            animation: active ? `ss-talk 0.9s ${n * 0.13}s ease-in-out infinite` : undefined,
          }}
        />
      ))}
    </span>
  )
}

/** The bars' keyframes, and their reduced-motion stillness. Rendered once by the page. */
export function NarrationStyles() {
  return (
    <style>{`
      @keyframes ss-talk { 0%, 100% { height: 30%; } 50% { height: 100%; } }
      @media (prefers-reduced-motion: reduce) {
        [style*="ss-talk"] { animation: none !important; height: 60% !important; }
      }
    `}</style>
  )
}

/** The narrator switch: on by default, remembered for the session. */
export function NarratorToggle({ on, onChange }: { on: boolean; onChange(on: boolean): void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className="ak-panel flex min-h-11 items-center gap-2 rounded-full border px-3 text-base"
      data-testid="narrator-toggle"
    >
      <span aria-hidden="true">{on ? '🔊' : '🔇'}</span>
      Narrator {on ? 'on' : 'off'}
    </button>
  )
}
