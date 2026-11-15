/**
 * The browser's own voice, with its events as hooks.
 *
 * `speechSynthesis` speaks through the operating system's audio, not the page's
 * AudioContext, so nothing here passes through scsynth — the hooks are how the
 * two meet. Each one fires on the main thread *after* the OS reports it, so a
 * hook is late by tens of milliseconds, by an amount that varies with the
 * device. Good for reacting to speech; approximate for placing it.
 *
 * The browser's own traps, handled once here:
 *
 * - **Voices arrive late.** `getVoices()` is empty until `voiceschanged` fires,
 *   and on some browsers that event never comes — so wait for it, but not
 *   forever.
 * - **Chrome drops `end`** for an utterance nothing holds a reference to: it is
 *   collected mid-speech and its events go with it. Every live utterance is
 *   kept in `speaking` until it ends.
 * - **iOS needs a gesture** for the first `speak()`. `unlock()` is called from
 *   the start tap and speaks one silent space.
 * - **Word events depend on the voice.** On-device voices usually send
 *   `boundary`; Chrome's online Google voices do not. A page should say so
 *   rather than look broken.
 */

export interface Hooks {
  onStart?(): void
  onWord?(word: string, index: number): void
  onEnd?(): void
  onError?(error: string): void
}

const speaking = new Set<SpeechSynthesisUtterance>()

export const supported = (): boolean => typeof speechSynthesis !== 'undefined'

export function loadVoices(waitMs = 2000): Promise<SpeechSynthesisVoice[]> {
  if (!supported()) return Promise.resolve([])
  const now = speechSynthesis.getVoices()
  if (now.length > 0) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = () => {
      speechSynthesis.removeEventListener('voiceschanged', done)
      clearTimeout(timer)
      resolve(speechSynthesis.getVoices())
    }
    const timer = setTimeout(done, waitMs)
    speechSynthesis.addEventListener('voiceschanged', done)
  })
}

/** From the start tap, so iOS allows every later `speak()`. */
export function unlock() {
  if (!supported()) return
  const silent = new SpeechSynthesisUtterance(' ')
  silent.volume = 0
  speechSynthesis.speak(silent)
}

/**
 * Queue one utterance. The browser speaks them in order, one at a time.
 * `rate` is the voice's own: 1 is its normal pace, lower is slower.
 */
export function say(text: string, voice: SpeechSynthesisVoice | null, hooks: Hooks = {}, rate?: number) {
  const utterance = new SpeechSynthesisUtterance(text)
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  }
  if (rate !== undefined) utterance.rate = rate

  let words = 0
  utterance.onstart = () => hooks.onStart?.()
  utterance.onboundary = (event) => {
    if (event.name && event.name !== 'word') return
    // Safari leaves charLength at 0, so take the word from where it starts.
    const word = text.slice(event.charIndex).match(/^[\p{L}\p{N}'’-]+/u)?.[0] ?? ''
    hooks.onWord?.(word, words++)
  }
  const finish = () => speaking.delete(utterance)
  utterance.onend = () => {
    finish()
    hooks.onEnd?.()
  }
  utterance.onerror = (event) => {
    finish()
    // `interrupted` and `canceled` are what stopping looks like, not faults.
    if (event.error !== 'interrupted' && event.error !== 'canceled') hooks.onError?.(event.error)
  }

  speaking.add(utterance)
  speechSynthesis.speak(utterance)
}

export function stopAll() {
  if (!supported()) return
  speechSynthesis.cancel()
  speaking.clear()
}

/**
 * The voice to start on: one in the device's own language, on the device rather
 * than online — it works offline, keeps the text on the phone, and is the kind
 * that sends word events.
 */
export function preferred(voices: SpeechSynthesisVoice[], language = navigator.language) {
  const prefix = language.toLowerCase().split('-')[0]
  const local = voices.filter((voice) => voice.localService)
  const pool = local.length > 0 ? local : voices
  return (
    pool.find((voice) => voice.lang.toLowerCase() === language.toLowerCase()) ??
    pool.find((voice) => voice.lang.toLowerCase().startsWith(prefix!)) ??
    pool.find((voice) => voice.default) ??
    pool[0] ??
    null
  )
}
