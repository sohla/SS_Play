import { useCallback, useEffect, useRef, useState } from 'react'
import { probeCapabilities } from '@ss/engine'
import { CheckRow, SourceFooter } from '@ss/ui'
import { playBeep, startSession, type Session } from './engine'

const LABELS: Record<string, string> = {
  audioWorklet: 'AudioWorklet',
  webWorker: 'Worker',
  wasm: 'WebAssembly',
  sharedArrayBuffer: 'SharedArrayBuffer',
  atomics: 'Atomics',
  crossOriginIsolated: 'crossOriginIsolated',
}

const WATCHED_METRICS = [
  'engineProcessCount',
  'engineMessagesProcessed',
  'engineMessagesDropped',
  'loadedSynthDefs',
  'audioHealthPct',
]

type Status = 'idle' | 'booting' | 'ready' | 'failed'

export function App() {
  const probe = probeCapabilities()
  const session = useRef<Session | null>(null)

  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const [playing, setPlaying] = useState(false)

  const boot = useCallback(async () => {
    if (status !== 'idle') return
    setStatus('booting')

    const result = await startSession()
    if (!result.ok) {
      setError(result.error.message)
      setStatus('failed')
      return
    }

    session.current = result.session
    setStatus('ready')
  }, [status])

  useEffect(() => {
    const live = session.current
    if (status !== 'ready' || !live) return
    // The poller owns its own 10Hz interval; this only re-renders when a value
    // actually changed. Phase 5 replaces it with useSyncExternalStore.
    return live.metrics.subscribe(() => setTick((n) => n + 1))
  }, [status])

  const play = useCallback(async () => {
    const live = session.current
    if (!live || playing) return
    setPlaying(true)
    try {
      await playBeep(live, 62)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setPlaying(false)
    }
  }, [playing])

  const live = session.current
  const metrics = live?.metrics.snapshot ?? {}
  // Read live rather than snapshotting at boot: `version` is null until the
  // worklet reports it, which happens after init() resolves.
  const info = live?.sonic.getInfo()

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-neutral-200">
      <h1 className="text-lg font-semibold tracking-tight">SS_Play playground</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Phase 3 — scsynth running in the browser.
      </p>

      <section className="mt-8">
        {Object.entries(probe.capabilities).map(([key, available]) => (
          <CheckRow
            key={key}
            label={LABELS[key] ?? key}
            value={available ? 'available' : 'missing'}
            ok={available}
          />
        ))}
        <CheckRow
          label="expected transport"
          value={probe.expectedMode}
          ok={probe.expectedMode === 'sab'}
          detail={
            probe.expectedMode === 'sab'
              ? 'lowest latency'
              : `degraded: missing ${probe.sabUnavailable.join(', ')}`
          }
        />
      </section>

      <section className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={boot}
          disabled={status !== 'idle'}
          className="rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm hover:border-neutral-500 disabled:opacity-40"
        >
          {status === 'idle' ? 'Boot scsynth' : status === 'booting' ? 'Booting…' : 'Booted'}
        </button>

        {status === 'ready' ? (
          <button
            type="button"
            onClick={play}
            disabled={playing}
            className="rounded border border-emerald-700 bg-emerald-950 px-4 py-2 text-sm text-emerald-200 hover:border-emerald-500 disabled:opacity-40"
          >
            {playing ? 'Sounding…' : 'Play beep'}
          </button>
        ) : null}
      </section>

      {error ? (
        <p className="mt-4 rounded border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-300">
          {error}
        </p>
      ) : null}

      {live ? (
        <>
          <section className="mt-8 rounded-md border border-neutral-800 bg-surface p-4">
            <CheckRow
              label="achieved transport"
              value={live.mode}
              ok={live.mode === 'sab'}
              detail={live.mode === 'sab' ? 'lowest latency' : 'degraded'}
            />
            <CheckRow
              label="scsynth version"
              // getInfo() types version as string | null and this build does
              // not report one, so an absent version is not a fault.
              value={info?.version ?? '—'}
              ok
            />
            <CheckRow
              label="sample rate"
              value={`${info?.sampleRate ?? 0} Hz`}
              ok={Boolean(info?.sampleRate)}
            />
            <CheckRow
              label="boot time"
              value={`${Math.round(info?.bootTimeMs ?? 0)} ms`}
              ok={Boolean(info?.bootTimeMs)}
            />
            <CheckRow
              label="synthdefs loaded"
              value={live.loadedSynthDefs.join(', ') || 'none'}
              ok={live.loadedSynthDefs.length > 0}
            />
            {live.degraded ? (
              <p className="mt-3 text-sm text-amber-300">{live.degraded.reason}</p>
            ) : null}
          </section>

          <section className="mt-6 rounded-md border border-neutral-800 bg-surface p-4">
            {WATCHED_METRICS.map((name) => (
              <CheckRow
                key={name}
                label={name}
                value={String(metrics[name] ?? '—')}
                ok={name === 'engineMessagesDropped' ? metrics[name] === 0 : true}
              />
            ))}
          </section>
        </>
      ) : null}

      <SourceFooter />
    </main>
  )
}
