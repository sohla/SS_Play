export interface OscLogEntry {
  direction: 'in' | 'out'
  address: string
  args: unknown[]
  at: number
}

export interface OscLogProps {
  entries: OscLogEntry[]
  total: number
  dropped: number
  limit?: number
}

/**
 * The tail of the OSC stream.
 *
 * Shows newest first and bounds what it renders: the store already caps what it
 * keeps, and rendering five hundred rows would undo the point of throttling the
 * updates in the first place.
 */
export function OscLog({ entries, total, dropped, limit = 40 }: OscLogProps) {
  const shown = entries.slice(-limit).reverse()

  return (
    <div className="flex flex-col">
      <div className="flex justify-between pb-1 font-mono text-xs text-neutral-500">
        <span>{total} messages</span>
        {dropped > 0 ? <span>{dropped} older dropped</span> : null}
      </div>

      <div className="max-h-64 overflow-y-auto font-mono text-xs">
        {shown.length === 0 ? (
          <p className="py-2 text-neutral-600">nothing yet</p>
        ) : (
          shown.map((entry, index) => (
            <div key={`${entry.at}-${index}`} className="flex gap-2 py-0.5">
              <span
                className={entry.direction === 'in' ? 'text-sky-400' : 'text-amber-400'}
                aria-label={entry.direction === 'in' ? 'from scsynth' : 'to scsynth'}
              >
                {entry.direction === 'in' ? '←' : '→'}
              </span>
              <span className="min-w-40 text-neutral-300">{entry.address}</span>
              <span className="truncate text-neutral-500">{summarise(entry.args)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const summarise = (args: unknown[]) =>
  args
    .map((arg) => (typeof arg === 'number' ? Math.round(arg * 1000) / 1000 : String(arg)))
    .join(' ')
