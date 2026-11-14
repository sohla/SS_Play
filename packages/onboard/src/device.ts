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

export function narrate(text: string, hooks: { onStart?(): void; onEnd?(): void }) {
  if (!canSpeak()) return
  const utterance = new SpeechSynthesisUtterance(text)
  const chosen = voice()
  if (chosen) {
    utterance.voice = chosen
    utterance.lang = chosen.lang
  }
  utterance.onstart = () => hooks.onStart?.()
  const finish = () => {
    speaking.delete(utterance)
    hooks.onEnd?.()
  }
  utterance.onend = finish
  utterance.onerror = finish
  speaking.add(utterance)
  speechSynthesis.cancel()
  speechSynthesis.speak(utterance)
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
