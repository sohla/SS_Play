export interface CheckRowProps {
  label: string
  value: string
  ok: boolean
  detail?: string
}

export function CheckRow({ label, value, ok, detail }: CheckRowProps) {
  return (
    <div className="flex items-baseline gap-3 border-b border-neutral-800 py-2 last:border-0">
      <span
        aria-hidden
        className={`size-2 shrink-0 rounded-full ${ok ? 'bg-emerald-400' : 'bg-rose-500'}`}
      />
      <span className="min-w-56 font-mono text-sm text-neutral-400">{label}</span>
      <span className={`font-mono text-sm ${ok ? 'text-emerald-300' : 'text-rose-300'}`}>
        {value}
      </span>
      {detail ? <span className="text-xs text-neutral-500">{detail}</span> : null}
    </div>
  )
}
