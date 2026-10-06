import { useEffect, useState } from 'react'
import { useMetrics, useNodeTree, useOscLog, useSuperSonic } from '@ss/react'
import { BootGate, MetricsPanel, NodeTree, OscLog, PageHeader, SourceFooter } from '@ss/ui'
import { SynthDefBrowser } from './SynthDefBrowser.tsx'
import { fetchManifest, type VendorManifest } from './synthdefs.ts'

const WATCHED = [
  'engineProcessCount',
  'engineMessagesProcessed',
  'engineMessagesDropped',
  'loadedSynthDefs',
  'audioHealthPct',
]

export function App() {
  const { status, boot, probe, session } = useSuperSonic()
  const [manifest, setManifest] = useState<VendorManifest | null>(null)

  useEffect(() => {
    fetchManifest().then(setManifest).catch(() => setManifest(null))
  }, [])

  const booted = status.phase === 'ready' || status.phase === 'degraded'

  return (
    <>
      <PageHeader title="scsynth tester" />
      <main className="pad-safe mx-auto flex max-w-3xl flex-col gap-6 pt-8 text-neutral-200 sm:gap-8 sm:pt-12">
      <header>
        <p className="text-sm text-neutral-500">
          scsynth in the browser, with controls generated from each SynthDef's own contract.
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

      {booted && manifest ? (
        <>
          <Panel title="SynthDefs">
            <SynthDefBrowser manifest={manifest} session={session()} />
          </Panel>

          <Panel title="Engine">
            <Metrics />
          </Panel>

          <div className="grid min-w-0 gap-6 md:grid-cols-2">
            <Panel title="OSC">
              <Log />
            </Panel>
            <Panel title="Nodes">
              <Nodes />
            </Panel>
          </div>
        </>
      ) : null}

      <SourceFooter />
      </main>
    </>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-md border border-neutral-800 bg-surface p-3 sm:p-4">
      <h2 className="pb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {title}
      </h2>
      {children}
    </section>
  )
}

// Each of these subscribes on its own, so a panel that is not mounted costs no
// polling and no renders.
const Metrics = () => (
  <MetricsPanel metrics={useMetrics()} names={WATCHED} zeroIsGood={['engineMessagesDropped']} />
)

const Log = () => {
  const log = useOscLog()
  return <OscLog entries={log.entries} total={log.total} dropped={log.dropped} />
}

const Nodes = () => <NodeTree tree={useNodeTree()} />
