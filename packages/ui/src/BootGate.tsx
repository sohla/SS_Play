import type { ReactNode } from 'react'

export interface BootGateProps {
  phase: 'idle' | 'booting' | 'ready' | 'degraded' | 'failed'
  error?: string | null
  degradedReason?: string | null
  /** Why the fast transport is unavailable, from the pre-boot probe. */
  sabUnavailable?: string[]
  onBoot(): void
  children?: ReactNode
}

/**
 * The user gesture that starts audio, plus every reason it might not be good.
 *
 * Lives in the shared kit because every page needs exactly this and none should
 * write it twice — in particular the degraded banner, which is the only thing
 * that tells a visitor why a page sounds worse than it should.
 */
export function BootGate({
  phase,
  error,
  degradedReason,
  sabUnavailable = [],
  onBoot,
  children,
}: BootGateProps) {
  const booted = phase === 'ready' || phase === 'degraded'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBoot}
          disabled={phase === 'booting' || booted}
          // min-h-11 is the 44px touch target. This is the gesture that
          // starts audio at all, so a miss reads as "the page is broken".
          className="min-h-11 shrink-0 rounded border border-neutral-700 bg-neutral-900 px-5 text-sm hover:border-neutral-500 disabled:opacity-40"
        >
          {phase === 'idle'
            ? 'Start audio'
            : phase === 'booting'
              ? 'Starting…'
              : phase === 'failed'
                ? 'Start audio'
                : 'Running'}
        </button>

        {booted ? children : null}
      </div>

      {phase === 'idle' && sabUnavailable.length > 0 ? (
        <p className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          This page will run in compatibility mode: {sabUnavailable.join(', ')} unavailable. Audio
          will work, with higher latency and no capture.
        </p>
      ) : null}

      {phase === 'degraded' && degradedReason ? (
        <p className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          {degradedReason}
        </p>
      ) : null}

      {phase === 'failed' && error ? (
        <p className="rounded border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-300">
          {error}
        </p>
      ) : null}
    </div>
  )
}
