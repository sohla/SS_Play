import { useState } from 'react'
import { ctl, i } from '@ss/engine'
import { useMetrics, useSuperSonic } from '@ss/react'
import { BootGate, EngineFooter, PageHeader, SourceFooter } from '@ss/ui'

const DEF = 'ssp_sine'

export function App() {
  const { status, boot, probe, session } = useSuperSonic()
  const metrics = useMetrics()
  const [playing, setPlaying] = useState(false)

  // Deliberately not importing the playground's playNote: a second page should
  // need nothing from the first, only from packages/. If this file had to reach
  // into apps/playground to work, the shared layer would be in the wrong place.
  async function play() {
    const live = session()
    if (!live) return

    const nodeId = live.sonic.nextNodeId()
    const ended = live.dispatcher.waitForNodeEnd(nodeId, { timeoutMs: 6000 })

    setPlaying(true)
    live.sonic.send('/s_new', DEF, nodeId, 0, 0, ...ctl({ freq: 330, amp: 0.2 }))
    // ssp_sine is gated, so it sustains until released. Without the gate-off it
    // never frees and maxNodes fills up — which presents as later notes
    // silently failing rather than as an error.
    setTimeout(() => live.sonic.send('/n_set', nodeId, 'gate', i(0)), 800)

    await ended.catch(() => {})
    setPlaying(false)
  }

  const booted = status.phase === 'ready' || status.phase === 'degraded'

  return (
    <>
      <PageHeader title="scratch" />
      <main className="pad-safe mx-auto flex max-w-xl flex-col gap-6 pt-8 text-neutral-200 sm:gap-8 sm:pt-12">
      <header>
        <p className="text-sm text-neutral-500">
          A throwaway second page. It exists to show that adding one costs a directory and a line in{' '}
          <code className="text-neutral-400">infra/sites.json</code> — no DNS record, no
          certificate, no server change.
        </p>
      </header>

      <BootGate
        phase={status.phase}
        error={status.error}
        degradedReason={status.degradedReason}
        sabUnavailable={probe.sabUnavailable}
        onBoot={boot}
      >
        <span className="font-mono text-xs text-neutral-500">
          {status.mode} · {status.loadedSynthDefs.length} loaded
        </span>
      </BootGate>

      {booted ? (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={play}
            disabled={playing}
            data-testid="play"
            className="min-h-11 rounded border border-neutral-700 bg-surface px-5 text-sm hover:border-neutral-500 disabled:opacity-40"
          >
            {playing ? 'sounding…' : `play ${DEF}`}
          </button>
          <span className="font-mono text-xs text-neutral-500" data-testid="blocks">
            {metrics['engineProcessCount'] ?? 0} blocks
          </span>
        </div>
      ) : null}

      <SourceFooter />
      {booted ? <EngineFooter /> : null}
      </main>
    </>
  )
}
