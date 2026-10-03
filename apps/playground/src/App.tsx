import { probeCapabilities } from '@ss/engine'
import { CheckRow, SourceFooter } from '@ss/ui'

const LABELS: Record<string, string> = {
  audioWorklet: 'AudioWorklet',
  webWorker: 'Worker',
  wasm: 'WebAssembly',
  sharedArrayBuffer: 'SharedArrayBuffer',
  atomics: 'Atomics',
  crossOriginIsolated: 'crossOriginIsolated',
}

export function App() {
  const { capabilities, expectedMode, blocking, sabUnavailable } = probeCapabilities()

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-neutral-200">
      <h1 className="text-lg font-semibold tracking-tight">SS_Play playground</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Phase 1 — platform capabilities only. No audio engine yet.
      </p>

      <section className="mt-8">
        {Object.entries(capabilities).map(([key, available]) => (
          <CheckRow
            key={key}
            label={LABELS[key] ?? key}
            value={available ? 'available' : 'missing'}
            ok={available}
          />
        ))}
      </section>

      <section className="mt-8 rounded-md border border-neutral-800 bg-surface p-4">
        <CheckRow
          label="transport mode"
          value={expectedMode}
          ok={expectedMode === 'sab'}
          detail={expectedMode === 'sab' ? 'lowest latency' : 'degraded'}
        />
        {blocking.length > 0 ? (
          <p className="mt-3 text-sm text-rose-300">
            The engine cannot boot here. Missing: {blocking.join(', ')}.
          </p>
        ) : null}
        {blocking.length === 0 && sabUnavailable.length > 0 ? (
          <p className="mt-3 text-sm text-amber-300">
            Audio would work but capture would not, and latency would be higher. Missing:{' '}
            {sabUnavailable.join(', ')}. Check the COOP/COEP response headers.
          </p>
        ) : null}
      </section>

      <SourceFooter />
    </main>
  )
}
