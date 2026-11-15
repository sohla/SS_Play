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
import { SPEECH_RATE, canSpeak, hush, narrate } from './device.ts'
import { estimatedTimes, wordAt, wordsOf, type Part } from './words.ts'

/**
 * Every screen reads itself aloud, a line at a time, and lights each word as it
 * is said.
 *
 * The pace is the point: one short line, a chime, a breath, then the next. Each
 * line is its own utterance, so a slow voice never drags the highlight out of
 * step for long. The highlight follows the voice's own word events where it
 * sends them, and an estimate (see `estimatedTimes`) where it does not — held
 * back a moment, because a voice's `start` can arrive well before its sound and
 * an estimate started then runs ahead and jumps back.
 *
 * Accessibility, which this has to get right rather than merely survive:
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
  /** The chime between lines; a no-op until the engine is up. */
  chime(): void
}

export const NarratorContext = createContext<Narrator>({ on: true, unlocked: false, chime: () => {} })

/** How long a line's voice may take to start before the screen stops waiting for it. */
const NO_VOICE_MS = 4000
/** With no word event this long after a line starts, follow the estimate instead. */
const ESTIMATE_AFTER_MS = 600
/** The breath after each line's chime. */
const GAP_MS = 1600

export interface NarrationOptions {
  /** Speak when the screen appears. */
  auto?: boolean
  /** Speak even with the narrator off — for the voice check, where the voice is the test. */
  always?: boolean
  /** A chime after each line. Off where a chime would be measured as the voice. */
  chimes?: boolean
  onStart?(): void
  /** `heard` is false when the voice never started. */
  onEnd?(heard: boolean): void
}

export interface Narration {
  play(): void
  speaking: boolean
  /** True once this screen's narration has finished, or was never going to happen. */
  done: boolean
  view: ReactNode
}

export function useNarration(parts: readonly Part[], options: NarrationOptions = {}): Narration {
  const { auto = true, always = false } = options
  const { on, unlocked, chime } = useContext(NarratorContext)
  const key = parts.map((part) => `${part.kind}:${part.text}`).join('|')
  // `parts` is a fresh array each render; `key` is what actually identifies it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { words } = useMemo(() => wordsOf(parts), [key])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lines = useMemo(() => parts.map((part) => part.text), [key])

  const [current, setCurrent] = useState(-1)
  const [reached, setReached] = useState(-1)
  const [speaking, setSpeaking] = useState(false)
  const [done, setDone] = useState(false)

  const hooks = useRef(options)
  hooks.current = options
  const chimeRef = useRef(chime)
  chimeRef.current = chime
  /** Bumped on every play and on leaving, so a cancelled run cannot report in. */
  const run = useRef(0)

  const play = useCallback(() => {
    const token = ++run.current
    const live = () => token === run.current
    let heard = false
    setDone(false)
    setCurrent(-1)
    setReached(-1)

    const finish = () => {
      if (!live()) return
      setSpeaking(false)
      setCurrent(-1)
      setDone(true)
      hooks.current.onEnd?.(heard)
    }
    if (!canSpeak()) return finish()
    setSpeaking(true)

    const light = (n: number) => {
      setCurrent(n)
      setReached((was) => Math.max(was, n))
    }

    const line = (index: number) => {
      if (!live()) return
      if (index >= lines.length) return finish()
      const mine = words.map((word, n) => ({ word, n })).filter(({ word }) => word.part === index)
      const offset = mine[0]?.word.start ?? 0
      let started = false
      let fromVoice = false
      let highest = -1
      const timers: ReturnType<typeof setTimeout>[] = []
      const stopEstimate = () => timers.forEach(clearTimeout)
      // Never backwards: a late word event must not undo the estimate.
      const lightOnce = (n: number) => {
        if (n < highest) return
        highest = n
        light(n)
      }

      const silent = setTimeout(() => !started && finish(), NO_VOICE_MS)
      narrate(lines[index]!, {
        onStart: () => {
          if (!live()) return
          started = true
          clearTimeout(silent)
          if (!heard) hooks.current.onStart?.()
          heard = true
          if (mine[0]) lightOnce(mine[0].n)
          timers.push(
            setTimeout(() => {
              if (!live() || fromVoice) return
              const times = estimatedTimes(mine.map(({ word }) => word))
              times.forEach((at, k) =>
                timers.push(setTimeout(() => live() && !fromVoice && lightOnce(mine[k]!.n), at / SPEECH_RATE)),
              )
            }, ESTIMATE_AFTER_MS),
          )
        },
        onWord: (charIndex) => {
          if (!live()) return
          fromVoice = true
          stopEstimate()
          lightOnce(wordAt(words, offset + charIndex))
        },
        onEnd: (cut) => {
          clearTimeout(silent)
          stopEstimate()
          if (!live()) return
          // Cut off — Play was pressed, or the narrator turned off: stop here.
          if (cut) return finish()
          setCurrent(-1)
          if (hooks.current.chimes ?? true) chimeRef.current()
          timers.push(setTimeout(() => line(index + 1), index + 1 < lines.length ? GAP_MS : GAP_MS / 2))
        },
      })
    }
    line(0)
  }, [lines, words])

  // Speak on arrival, if this screen should — otherwise it is done already.
  useEffect(() => {
    if (auto && unlocked && (on || always)) play()
    else setDone(true)
    return () => {
      run.current += 1
    }
  }, [auto, unlocked, on, always, play])

  // Leaving a screen mid-sentence stops the sentence.
  useEffect(
    () => () => {
      run.current += 1
      hush()
    },
    [],
  )

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
