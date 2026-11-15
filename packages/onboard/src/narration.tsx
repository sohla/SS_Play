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
import { canSpeak, hush, narrate } from './device.ts'
import { estimatedTimes, wordAt, wordsOf, type Part } from './words.ts'

/**
 * Every screen reads itself aloud, and lights each word as it is said.
 *
 * Reading and hearing at once is the point: the person may not have the volume
 * up yet, so the text leads, and the voice and the moving highlight make it
 * easy to follow and a little playful. The highlight follows the voice's own
 * word events where it sends them; where it does not, it follows an estimate
 * (see `estimatedTimes`), so it always moves.
 *
 * Accessibility, which this has to get right rather than merely survive:
 *
 * - Screen readers get each part's text whole; the animated words are hidden
 *   from them, so nothing is read out one fragment at a time.
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
}

export const NarratorContext = createContext<Narrator>({ on: true, unlocked: false })

/** How long a voice may take to start before the screen stops waiting for it. */
const NO_VOICE_MS = 4000

export interface NarrationOptions {
  /** Speak when the screen appears. */
  auto?: boolean
  /** Speak even with the narrator off — for the voice check, where the voice is the test. */
  always?: boolean
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
  const { on, unlocked } = useContext(NarratorContext)
  const key = parts.map((part) => `${part.kind}:${part.text}`).join('|')
  // `parts` is a fresh array each render; `key` is what actually identifies it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { spoken, words } = useMemo(() => wordsOf(parts), [key])

  const [current, setCurrent] = useState(-1)
  const [speaking, setSpeaking] = useState(false)
  const [done, setDone] = useState(false)

  const hooks = useRef(options)
  hooks.current = options
  /** Bumped on every play and on leaving, so a cancelled run cannot report in. */
  const run = useRef(0)

  const play = useCallback(() => {
    const token = ++run.current
    const live = () => token === run.current
    setDone(false)
    setCurrent(-1)

    if (!canSpeak()) {
      setDone(true)
      hooks.current.onEnd?.(false)
      return
    }

    let started = false
    let fromVoice = false
    const timers: ReturnType<typeof setTimeout>[] = []
    const stopEstimate = () => timers.forEach(clearTimeout)

    const silent = setTimeout(() => {
      if (!live() || started) return
      setDone(true)
      hooks.current.onEnd?.(false)
    }, NO_VOICE_MS)

    narrate(spoken, {
      onStart: () => {
        if (!live()) return
        started = true
        clearTimeout(silent)
        setSpeaking(true)
        hooks.current.onStart?.()
        estimatedTimes(words).forEach((at, n) =>
          timers.push(setTimeout(() => live() && !fromVoice && setCurrent(n), at)),
        )
      },
      onWord: (charIndex) => {
        if (!live()) return
        // The real thing has arrived: drop the estimate and follow the voice.
        fromVoice = true
        stopEstimate()
        setCurrent(wordAt(words, charIndex))
      },
      onEnd: () => {
        if (!live()) return
        clearTimeout(silent)
        stopEstimate()
        setSpeaking(false)
        setCurrent(-1)
        setDone(true)
        hooks.current.onEnd?.(started)
      },
    })
  }, [spoken, words])

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

  const view = <Spoken parts={parts} words={words} current={current} speaking={speaking} />
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
  speaking,
}: {
  parts: readonly Part[]
  words: ReturnType<typeof wordsOf>['words']
  current: number
  speaking: boolean
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
                    : speaking && n > current
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
