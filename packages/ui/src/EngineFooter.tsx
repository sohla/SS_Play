import { useAudioLatency, useMetrics, useNodeTree, type TreeNode } from '@ss/react'

/**
 * Synths in the tree, counted rather than inferred from nodeCount.
 *
 * Subtracting a fixed number of groups looked simpler and was wrong: the touch
 * page puts its voices in a group of its own and the others do not, so any
 * constant is correct on one page and off by one on the rest.
 */
function countSynths(node: TreeNode | undefined): number {
  if (!node) return 0
  const self = node.type === 'synth' ? 1 : 0
  return self + (node.children ?? []).reduce((total, child) => total + countSynths(child), 0)
}

/**
 * What the engine is doing, on every page that runs one.
 *
 * Self-contained so it subscribes on its own: the metrics poller runs at 10Hz
 * and the tree at 2Hz, and reading them in a page component would re-render the
 * page around them. Only this footer redraws.
 *
 * There is no UGen count to show. The engine reports 73 metrics and none of
 * them counts UGens — the live figure worth having is synths, which is what a
 * note that failed to free shows up in.
 */
export function EngineFooter() {
  const metrics = useMetrics()
  const tree = useNodeTree()
  const latency = useAudioLatency()

  const health = metrics['audioHealthPct']
  const voices = countSynths(tree?.root)

  return (
    <footer
      data-testid="engine-footer"
      className="pad-safe flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 pt-1 font-mono text-[10px] text-neutral-600"
    >
      {latency ? (
        <span
          data-testid="latency"
          title="render buffer + output path. The engine itself adds one render quantum."
        >
          {latency.baseMs.toFixed(1)} + {latency.outputMs.toFixed(1)} ={' '}
          {(latency.baseMs + latency.outputMs).toFixed(0)}ms
        </span>
      ) : null}

      {health !== undefined ? (
        // Below 100 means the audio thread missed a deadline. It is the one
        // number here that is a problem rather than a measurement.
        <span
          data-testid="health"
          className={Number(health) < 100 ? 'text-rose-400' : undefined}
        >
          {health}% health
        </span>
      ) : null}

      <span data-testid="voices">{voices} voices</span>

      {metrics['engineMessagesProcessed'] !== undefined ? (
        <span data-testid="messages">{metrics['engineMessagesProcessed']} msgs</span>
      ) : null}

      {latency ? <span className="ml-auto">{(latency.sampleRate / 1000).toFixed(1)}kHz</span> : null}
    </footer>
  )
}
