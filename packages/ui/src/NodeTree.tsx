export interface TreeNode {
  id: number
  type: 'group' | 'synth'
  defName?: string
  children?: TreeNode[]
}

export interface NodeTreeProps {
  tree: { nodeCount: number; root: TreeNode } | null
  /** Warn above this, since maxNodes exhaustion presents as silent failure. */
  warnAbove?: number
}

/**
 * The server's node tree.
 *
 * Worth having visible while developing: a def that never frees itself shows up
 * here as a count that only climbs, long before it exhausts maxNodes and new
 * notes start failing silently.
 */
export function NodeTree({ tree, warnAbove = 256 }: NodeTreeProps) {
  if (!tree) return <p className="font-mono text-xs text-neutral-600">no tree yet</p>

  return (
    <div className="font-mono text-xs">
      <p className={tree.nodeCount > warnAbove ? 'text-rose-300' : 'text-neutral-400'}>
        {tree.nodeCount} nodes
        {tree.nodeCount > warnAbove ? ' — climbing? check for a missing doneAction' : ''}
      </p>
      <div className="mt-1 max-h-48 overflow-y-auto">
        <Node node={tree.root} depth={0} />
      </div>
    </div>
  )
}

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  return (
    <div>
      <div style={{ paddingLeft: depth * 12 }} className="text-neutral-500">
        <span className="text-neutral-600">{node.type === 'group' ? '▾' : '·'}</span>{' '}
        <span className="text-neutral-400">{node.id}</span>{' '}
        {node.defName ? <span className="text-emerald-400">{node.defName}</span> : null}
      </div>
      {node.children?.map((child) => <Node key={child.id} node={child} depth={depth + 1} />)}
    </div>
  )
}
