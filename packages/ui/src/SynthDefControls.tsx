import { useCallback, useState } from 'react'
import { isDiscrete, mapSpec, unmapSpec, type ControlSpec, type SynthDefContract } from '@ss/engine'

export interface SynthDefControlsProps {
  contract: SynthDefContract
  values: Record<string, number>
  onChange(name: string, value: number): void
}

/**
 * A control surface generated from the SynthDef's own contract.
 *
 * No range is written here. Every slider's bounds and curve come from the spec
 * the def declares, resolved to numbers by the sidecar build — so a page and
 * the sclang authoring rig move a control identically.
 *
 * Sliders work in 0..1 and map through the spec, which is the normalisation
 * worth having: a MIDI CC or a touch position feeds the same path.
 */
export function SynthDefControls({ contract, values, onChange }: SynthDefControlsProps) {
  return (
    <div className="flex flex-col gap-1">
      {contract.specs.map((spec) => (
        <SpecControl
          key={spec.name}
          spec={spec}
          value={values[spec.name] ?? spec.default}
          onChange={(value) => onChange(spec.name, value)}
        />
      ))}

      {contract.frozen.map((frozen) => (
        <PinnedRow key={frozen.name} name={frozen.name} detail={`${frozen.value}`} note="frozen" />
      ))}

      {contract.supplied.map((supplied) => (
        <PinnedRow key={supplied.name} name={supplied.name} detail="" note="per event" />
      ))}

      {(contract.unknown ?? []).map((unknown) => (
        <PinnedRow
          key={unknown.name}
          name={unknown.name}
          detail={String(round(unknown.default))}
          note="no range"
        />
      ))}
    </div>
  )
}

const round = (value: number) => Math.round(value * 1000) / 1000

function SpecControl({
  spec,
  value,
  onChange,
}: {
  spec: ControlSpec
  value: number
  onChange(value: number): void
}) {
  const discrete = isDiscrete(spec)
  const [unit, setUnit] = useState(() => unmapSpec(spec, value))
  const [draft, setDraft] = useState<string | null>(null)

  const handle = useCallback(
    (nextUnit: number) => {
      setUnit(nextUnit)
      onChange(mapSpec(spec, nextUnit))
    },
    [onChange, spec],
  )

  // Typing a value is the only way to reach a precise one: a slider over an
  // exponential range cannot be nudged to exactly 440, and a cutoff you want at
  // a specific note is not something to hunt for by dragging.
  const commit = useCallback(() => {
    if (draft === null) return
    const parsed = Number(draft)
    setDraft(null)
    if (!Number.isFinite(parsed)) return

    // Clamp rather than reject: typing 50000 into a 20..20000 control means
    // "as high as it goes", and refusing it outright is unhelpful.
    const lo = Math.min(spec.min, spec.max)
    const hi = Math.max(spec.min, spec.max)
    const clamped = Math.min(Math.max(parsed, lo), hi)

    setUnit(unmapSpec(spec, clamped))
    onChange(discrete ? Math.round(clamped) : clamped)
  }, [discrete, draft, onChange, spec])

  // On a phone the name and value share the top line and the slider gets the
  // full width beneath; from sm: up it collapses to one row. Three columns in
  // 390px leaves the slider about 130px, which is too coarse to set a cutoff
  // with and too narrow to read the value beside.
  return (
    <div className="flex flex-wrap items-center gap-x-3 py-0.5 sm:flex-nowrap sm:py-1">
      <span className="order-1 shrink-0 font-mono text-xs text-neutral-400 sm:w-28">
        {spec.name}
      </span>

      <input
        type="range"
        min={0}
        max={1}
        // A discrete control must land on whole values: SuperCollider's
        // Select.ar truncates toward zero, so a fractional index silently picks
        // the wrong branch rather than erroring.
        step={discrete ? 1 / Math.max(1, (spec.max - spec.min) / spec.step) : 0.001}
        value={unit}
        onChange={(event) => handle(Number(event.target.value))}
        className="ss-range order-3 basis-full sm:order-2 sm:min-w-0 sm:basis-auto sm:grow"
        aria-label={spec.name}
      />

      {draft === null ? (
        <button
          type="button"
          onClick={() => setDraft(String(discrete ? Math.round(value) : round(value)))}
          title={`${spec.min} to ${spec.max}${spec.units ? ` ${spec.units}` : ''} — tap to type`}
          // ml-auto pushes the value to the right edge on the wrapped layout,
          // where there is no slider between it and the name.
          className="order-2 ml-auto min-w-20 cursor-text py-2 text-right font-mono text-xs text-emerald-300 hover:text-emerald-200 sm:order-3 sm:ml-0 sm:py-0"
        >
          {format(value, spec)}
        </button>
      ) : (
        <input
          type="text"
          inputMode="decimal"
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
            // Escape abandons the edit, so a half-typed number never lands on
            // a synth that is currently sounding.
            if (event.key === 'Escape') setDraft(null)
          }}
          aria-label={`${spec.name} value`}
          className="order-2 ml-auto w-24 rounded border border-emerald-700 bg-neutral-900 px-1 py-1 text-right font-mono text-emerald-200 outline-none sm:order-3 sm:ml-0 sm:w-20 sm:text-xs"
        />
      )}
    </div>
  )
}

function PinnedRow({ name, detail, note }: { name: string; detail: string; note: string }) {
  return (
    <div className="flex items-center gap-3 py-1 text-xs text-neutral-600">
      <span className="shrink-0 font-mono sm:w-28">{name}</span>
      <span className="min-w-0 grow truncate font-mono">{detail}</span>
      <span className="shrink-0 text-right italic">{note}</span>
    </div>
  )
}

function format(value: number, spec: ControlSpec): string {
  const text = isDiscrete(spec)
    ? String(Math.round(value))
    : Math.abs(value) >= 100
      ? value.toFixed(0)
      : Math.abs(value) >= 1
        ? value.toFixed(2)
        : value.toFixed(3)

  return spec.units ? `${text} ${spec.units}` : text
}
