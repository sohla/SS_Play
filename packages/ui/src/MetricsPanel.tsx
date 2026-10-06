export interface MetricsPanelProps {
  metrics: Readonly<Record<string, number | string>>
  /** Metric names to show, in order. */
  names: string[]
  /** Names whose only acceptable value is zero. */
  zeroIsGood?: string[]
}

/** A fixed set of engine metrics, re-rendered only when a value changes. */
export function MetricsPanel({ metrics, names, zeroIsGood = [] }: MetricsPanelProps) {
  return (
    <div className="flex flex-col">
      {names.map((name) => {
        const value = metrics[name]
        const bad = zeroIsGood.includes(name) && value !== 0 && value !== undefined

        return (
          <div
            key={name}
            className="flex items-baseline justify-between gap-3 border-b border-neutral-800 py-1.5 last:border-0 sm:justify-start"
          >
            <span className="min-w-0 truncate font-mono text-xs text-neutral-400 sm:w-56 sm:shrink-0">
              {name}
            </span>
            <span
              className={`shrink-0 font-mono text-xs ${bad ? 'text-rose-300' : 'text-emerald-300'}`}
            >
              {value ?? '—'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
