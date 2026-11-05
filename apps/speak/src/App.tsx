import { useCallback, useEffect, useRef, useState } from 'react'
import { ctl, wallClockMs } from '@ss/engine'
import { useSuperSonic } from '@ss/react'
import { BootGate, EngineFooter, PageHeader, SourceFooter } from '@ss/ui'
import { phrasesFor } from './phrases.ts'
import { SPANS, dueBetween, secondOf, type Cue } from './program.ts'
import { loadVoices, preferred, say, stopAll, supported, unlock, type Hooks } from './speech.ts'

/**
 * A narrator on a minute-long program, with bells on its hooks.
 *
 * The voice is the browser's — see `speech.ts` for what that does and does not
 * allow. The bells are scsynth, played the moment each hook arrives, so what
 * you hear is the hook's own timing: a bell that lands late on a word is the
 * event arriving late, which is the thing worth knowing when composing with it.
 */

/**
 * `?from=15` starts the program clock at :15, to rehearse a part without
 * waiting for it. Shifts only the program and its display — devices given the
 * same `from` at different moments will not agree, so leave it off to perform.
 */
const FROM = new URLSearchParams(location.search).get('from')
let shiftMs = 0
const programMs = () => wallClockMs() + shiftMs

/** Taken when the program starts, half a second early so the cue at `from` fires. */
function rehearseFrom(second: string | null) {
  const at = Number(second)
  if (second === null || !Number.isFinite(at)) return
  const target = ((at % 60) + 60) % 60 * 1000 - 500
  shiftMs = (((target - (wallClockMs() % 60_000)) % 60_000) + 60_000) % 60_000
}

const PRETTY = 'sonic-pi-pretty_bell'
const DULL = 'sonic-pi-dull_bell'

/** The count climbs a pentatonic scale, so where you are in it is audible. */
const COUNT_NOTES = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93]
/** Tinkles for words, cycling, high and quiet. */
const TINKLES = [96, 98, 100, 103, 105, 108]

interface LogEntry {
  id: number
  second: number
  what: string
  detail: string
  /** How long after its cue was due this event arrived, ms. */
  late: number
}

export function App() {
  const { status, boot, probe, session } = useSuperSonic()
  const booted = status.phase === 'ready' || status.phase === 'degraded'

  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null)
  const [voiceUri, setVoiceUri] = useState('')
  const voice = useRef<SpeechSynthesisVoice | null>(null)
  voice.current = voices?.find((candidate) => candidate.voiceURI === voiceUri) ?? null

  const [log, setLog] = useState<LogEntry[]>([])
  const [wordsSeen, setWordsSeen] = useState(false)
  const [linesEnded, setLinesEnded] = useState(0)
  const nextId = useRef(0)

  useEffect(() => {
    void loadVoices().then((found) => {
      setVoices(found)
      setVoiceUri(preferred(found)?.voiceURI ?? '')
    })
  }, [])

  // From the tap: iOS lets a page speak only once a gesture has.
  const start = useCallback(() => {
    unlock()
    boot()
  }, [boot])

  const bell = useCallback(
    (def: string, note: number, amp: number, release: number) => {
      session()?.sonic.send('/s_new', def, -1, 0, 0, ...ctl({ note, amp, release }))
    },
    [session],
  )

  const record = useCallback((due: number, what: string, detail = '') => {
    const at = programMs()
    const entry = { id: nextId.current++, second: (at / 1000) % 60, what, detail, late: at - due }
    setLog((previous) => [entry, ...previous].slice(0, 14))
  }, [])

  const perform = useCallback(
    (cue: Cue, due: number) => {
      const lang = voice.current?.lang ?? navigator.language

      if (cue.kind === 'count') {
        say(String(cue.n), voice.current, {
          onStart: () => {
            bell(PRETTY, COUNT_NOTES[cue.n - 1]!, 0.25, 1.5)
            record(due, 'count', String(cue.n))
          },
          onError: (error) => record(due, 'error', error),
        })
        return
      }

      // One utterance per sentence: Chrome cuts off long ones, and each
      // sentence then gets its own start and end bells.
      for (const line of phrasesFor(lang)[cue.block]) {
        const hooks: Hooks = {
          onStart: () => {
            bell(PRETTY, 79, 0.25, 2)
            record(due, 'start', line)
          },
          onWord: (word, index) => {
            bell(PRETTY, TINKLES[index % TINKLES.length]!, 0.08, 0.4)
            setWordsSeen(true)
            record(due, 'word', word)
          },
          onEnd: () => {
            bell(DULL, 55, 0.3, 2)
            setLinesEnded((n) => n + 1)
            record(due, 'end', '')
          },
          onError: (error) => record(due, 'error', error),
        }
        say(line, voice.current, hooks)
      }
    },
    [bell, record],
  )

  // The program. Checked ten times a second, which is the resolution a cue
  // needs: the voice's own start latency swamps anything finer.
  useEffect(() => {
    if (!booted || !supported()) return
    rehearseFrom(FROM)
    let since = programMs()
    const timer = setInterval(() => {
      const now = programMs()
      for (const { cue, due } of dueBetween(since, now)) perform(cue, due)
      since = now
    }, 100)
    return () => {
      clearInterval(timer)
      stopAll()
    }
  }, [booted, perform])

  // The playhead, per frame, straight onto the element.
  const head = useRef<HTMLDivElement>(null)
  const clock = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!booted) return
    let frame = 0
    const draw = () => {
      const now = programMs()
      const inMinute = (now % 60_000) / 1000
      if (head.current) head.current.style.left = `${(inMinute / 60) * 100}%`
      if (clock.current) clock.current.textContent = `:${String(secondOf(now)).padStart(2, '0')}`
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [booted])

  const byLanguage = groupByLanguage(voices ?? [])

  return (
    <main className="ak flex min-h-dvh flex-col">
      <PageHeader title="speak" />

      <div className="pad-safe-x mx-auto flex w-full max-w-md flex-1 flex-col gap-5 pt-6">
        <p className="ak-label text-sm">
          A narrator in the browser&rsquo;s own voice, on a program that repeats every minute: a
          count to ten at the top of the minute, then a few sentences at :15 and :40. A bell rings
          when each line starts, a tinkle on each word, a low bell when it ends &mdash; played the
          moment the browser reports each one, so you can hear how late it is.
        </p>

        <BootGate
          phase={status.phase}
          error={status.error}
          degradedReason={status.degradedReason}
          sabUnavailable={probe.sabUnavailable}
          onBoot={start}
        />

        {!supported() ? (
          <p className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
            This browser has no speech synthesis.
          </p>
        ) : null}

        {voices !== null && voices.length === 0 && supported() ? (
          <p
            className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300"
            data-testid="no-voices"
          >
            The browser reports no voices. On Android, install a voice in the system&rsquo;s
            text-to-speech settings; on a desktop, try another browser.
          </p>
        ) : null}

        {voices && voices.length > 0 ? (
          <label className="flex flex-col gap-1">
            <span className="ak-label font-mono text-xs">voice</span>
            <select
              data-testid="voice"
              value={voiceUri}
              onChange={(event) => setVoiceUri(event.target.value)}
              className="ak-panel min-h-11 rounded border px-2 text-sm"
            >
              {byLanguage.map(([lang, group]) => (
                <optgroup key={lang} label={lang}>
                  {group.map((one) => (
                    <option key={one.voiceURI} value={one.voiceURI}>
                      {one.name}
                      {one.localService ? '' : ' (online)'}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        ) : null}

        {booted ? (
          <>
            <div className="flex flex-col gap-1">
              <div className="ak-label flex justify-between font-mono text-[11px]">
                <span>this minute</span>
                <span className="ak-accent" ref={clock} data-testid="second" />
              </div>
              <div className="ak-panel relative h-8 overflow-hidden rounded border" data-testid="timeline">
                {SPANS.map((span) => (
                  <div
                    key={span.label}
                    className="ak-label absolute top-0 flex h-full items-center border-x border-[var(--ak-line)] bg-[#141400] px-1 font-mono text-[10px]"
                    style={{
                      left: `${(span.from / 60) * 100}%`,
                      width: `${((span.to - span.from) / 60) * 100}%`,
                    }}
                  >
                    {span.label}
                  </div>
                ))}
                <div ref={head} className="absolute top-0 h-full w-0.5 bg-[var(--ak-accent)]" />
              </div>
            </div>

            {linesEnded > 0 && !wordsSeen ? (
              <p className="ak-label font-mono text-[11px]" data-testid="no-words">
                This voice sends no word events, so there are no tinkles. On-device voices usually
                do; Chrome&rsquo;s online Google voices do not.
              </p>
            ) : null}

            <ol className="flex flex-col font-mono text-[11px]" data-testid="log">
              {log.map((entry) => (
                <li
                  key={entry.id}
                  className="ak-label grid grid-cols-[3.5rem_3.5rem_1fr_4rem] gap-2 border-b border-[var(--ak-line)] py-0.5"
                >
                  <span>:{entry.second.toFixed(1).padStart(4, '0')}</span>
                  <span className="ak-accent">{entry.what}</span>
                  <span className="truncate">{entry.detail}</span>
                  <span className="text-right">+{(entry.late / 1000).toFixed(2)}s</span>
                </li>
              ))}
            </ol>
            <p className="ak-label font-mono text-[11px]">
              The right-hand column is how long after its cue each event reached the page. For
              words and ends that includes the speaking before it; for a start it is the
              voice&rsquo;s own delay.
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

/** Voices by language, with the device's own language first. */
function groupByLanguage(voices: SpeechSynthesisVoice[]): [string, SpeechSynthesisVoice[]][] {
  const groups = new Map<string, SpeechSynthesisVoice[]>()
  for (const voice of voices) groups.set(voice.lang, [...(groups.get(voice.lang) ?? []), voice])
  const own = navigator.language.toLowerCase().split('-')[0]!
  return [...groups.entries()].sort(([a], [b]) => {
    const mine = Number(b.toLowerCase().startsWith(own)) - Number(a.toLowerCase().startsWith(own))
    return mine || a.localeCompare(b)
  })
}

