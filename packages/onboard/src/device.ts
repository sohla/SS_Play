/**
 * The phone-specific parts: which instructions to show, keeping the screen
 * awake, and Version A's audio mode around its microphone. The narrator is
 * `@ss/speech`.
 */

import type { Platform } from './cues.ts'

export type { Platform }

/** iPadOS reports itself as a Mac, so a Mac with a touch screen is an iPad. */
export function platformOf(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>): Platform {
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return 'ios'
  if (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1) return 'ios'
  if (/Android/.test(nav.userAgent)) return 'android'
  return 'other'
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
 * Safari-only: "play-and-record" set *before* opening the microphone, and back
 * to "auto", the default, once it is closed. It is reported to help, not to
 * always work — hence the fix line that tells a person how to get the speaker
 * back by hand.
 *
 * Never "playback": set from the Start tap, it left the iPhone playing the
 * narrator and no Web Audio at all — the chime went silent from the commit
 * that added it, and nothing on desktop has the API to show it.
 */
export function audioSession(type: 'auto' | 'play-and-record') {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (!session) return
  try {
    session.type = type
  } catch {
    // An unknown type on an older Safari: nothing to do.
  }
}
