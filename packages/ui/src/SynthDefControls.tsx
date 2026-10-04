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

  const handle = useCallback(
    (nextUnit: number) => {
      setUnit(nextUnit)
      onChange(mapSpec(spec, nextUnit))
    },
    [onChange, spec],
  )

  return (
    <label className="flex items-center gap-3 py-1">
      <span className="min-w-28 shrink-0 font-mono text-xs text-neutral-400">{spec.name}</span>

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
        className="h-1 grow cursor-pointer appearance-none rounded bg-neutral-700 accent-emerald-400"
        aria-label={spec.name}
      />

      <output className="min-w-20 text-right font-mono text-xs text-emerald-300">
        {format(value, spec)}
      </output>
    </label>
  )
}

function PinnedRow({ name, detail, note }: { name: string; detail: string; note: string }) {
  return (
    <div className="flex items-center gap-3 py-1 text-xs text-neutral-600">
      <span className="min-w-28 shrink-0 font-mono">{name}</span>
      <span className="grow font-mono">{detail}</span>
      <span className="min-w-20 text-right italic">{note}</span>
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
