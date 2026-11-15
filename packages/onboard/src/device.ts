/**
 * The phone-specific parts: which instructions to show, the narrator, and
 * keeping the screen awake.
 */

export type Platform = 'ios' | 'android' | 'other'

/** iPadOS reports itself as a Mac, so a Mac with a touch screen is an iPad. */
export function platformOf(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>): Platform {
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return 'ios'
  if (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1) return 'ios'
  if (/Android/.test(nav.userAgent)) return 'android'
  return 'other'
}

// ---------------------------------------------------------------- narrator

/**
 * The browser's own voice. Its sound goes through the phone's speech system,
 * not the audio engine, which is why the spec checks it separately.
 *
 * Utterances are held in `speaking` until they end: Chrome drops the events of
 * one nothing references. `unlock` is called from the Start tap, because iOS
 * only lets a page speak after a gesture has.
 */
const speaking = new Set<SpeechSynthesisUtterance>()

export const canSpeak = (): boolean => typeof speechSynthesis !== 'undefined'

export function unlockVoice() {
  if (!canSpeak()) return
  const silent = new SpeechSynthesisUtterance(' ')
  silent.volume = 0
  speechSynthesis.speak(silent)
}

/** Daniel where the phone has him, as on `/speak/`; otherwise an English on-device voice. */
function voice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices()
  return (
    voices.find((one) => /^Daniel\b/.test(one.name)) ??
    voices.find((one) => one.localService && one.lang.toLowerCase().startsWith('en')) ??
    null
  )
}

/** Slower than the voice's default, which reads instructions far too briskly. */
export const SPEECH_RATE = 0.85

export interface NarrationHooks {
  onStart?(): void
  /** The character offset of the word now being spoken, where the voice says. */
  onWord?(charIndex: number): void
  /** `cut` is true when it was stopped part-way, by `hush` or a newer line. */
  onEnd?(cut: boolean): void
}

export function narrate(text: string, hooks: NarrationHooks) {
  if (!canSpeak()) return
  const utterance = new SpeechSynthesisUtterance(text)
  const chosen = voice()
  if (chosen) {
    utterance.voice = chosen
    utterance.lang = chosen.lang
  }
  utterance.rate = SPEECH_RATE
  utterance.onstart = () => hooks.onStart?.()
  utterance.onboundary = (event) => {
    if (event.name && event.name !== 'word') return
    hooks.onWord?.(event.charIndex)
  }
  const finish = (cut: boolean) => {
    speaking.delete(utterance)
    hooks.onEnd?.(cut)
  }
  utterance.onend = () => finish(false)
  utterance.onerror = (event) => finish(event.error === 'interrupted' || event.error === 'canceled')
  speaking.add(utterance)
  // Chrome can sit on a line spoken straight after cancel() for ten seconds or
  // more, so cancel only when something is actually talking, and give it a moment.
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel()
    setTimeout(() => speechSynthesis.speak(utterance), 150)
  } else {
    speechSynthesis.speak(utterance)
  }
}

// ---------------------------------------------------------------- awake

/**
 * Keep the screen on, and ask again whenever the page comes back to the front:
 * a wake lock is released whenever the page is hidden, and does not come back
 * on its own. Returns a function that lets it go.
 */
export function keepAwake(onChange?: (held: boolean) => void): () => void {
  const wake = (navigator as Navigator & {
    wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener(t: 'release', f: () => void): void }> }
  }).wakeLock
  if (!wake) {
    onChange?.(false)
    return () => {}
  }

  let lock: { release(): Promise<void> } | null = null
  let stopped = false

  const request = () => {
    if (stopped || document.visibilityState !== 'visible') return
    wake.request('screen').then(
      (sentinel) => {
        lock = sentinel
        onChange?.(true)
        sentinel.addEventListener('release', () => onChange?.(false))
      },
      () => onChange?.(false),
    )
  }

  request()
  document.addEventListener('visibilitychange', request)
  return () => {
    stopped = true
    document.removeEventListener('visibilitychange', request)
    void lock?.release()
  }
}

// ---------------------------------------------------------------- route

/**
 * Tell Safari what kind of audio this page makes, where it can be told.
 *
 * iOS sends a page's sound to the earpiece — the call speaker at the top — once
 * the page opens the microphone, and WebKit's bug tracker has reports of it
 * staying there after the microphone is closed. No web API chooses the speaker
 * on iOS (`setSinkId` is not there). The one lever is the Audio Session API,
 * Safari-only: "playback" for a page that only plays, "play-and-record" set
 * *before* opening the microphone and "playback" again once it is closed. It
 * is reported to help, not to always work — hence the fix line that tells a
 * person how to get the speaker back by hand.
 */
export function audioSession(type: 'playback' | 'play-and-record') {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (!session) return
  try {
    session.type = type
  } catch {
    // An unknown type on an older Safari: nothing to do.
  }
}

/** Stop whatever the narrator is saying, as when a screen is left mid-sentence. */
export function hush() {
  if (canSpeak()) speechSynthesis.cancel()
}
