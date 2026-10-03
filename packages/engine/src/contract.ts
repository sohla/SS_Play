/**
 * The parameter contract a SynthDef carries in its metadata, resolved to plain
 * numbers by the sidecar build.
 *
 * Every argument is in exactly one category, which `sc:test` enforces:
 *
 *   specs     has a range — gets a control in the UI
 *   frozen    pinned — sent, but not adjustable
 *   supplied  provided per event by whatever drives the synth
 *
 * This is what lets a page build its whole control surface without anyone
 * hand-writing a range in TypeScript, and without the browser needing
 * SuperCollider's spec table.
 */

/** A named warp, or a numeric curve for CurveWarp. */
export type Warp = 'linear' | 'lin' | 'exponential' | 'exp' | 'amp' | 'db' | number

export interface ControlSpec {
  name: string
  min: number
  max: number
  warp: Warp
  /** 0 is continuous. >= 1 means a discrete control: a stepper, not a fader. */
  step: number
  default: number
  units: string
}

export interface FrozenControl {
  name: string
  value: number
}

export interface SuppliedControl {
  name: string
  default: number
}

export interface SynthDefContract {
  specs: ControlSpec[]
  frozen: FrozenControl[]
  supplied: SuppliedControl[]
}

const round = (value: number, step: number) =>
  step === 0 ? value : Math.round(value / step) * step

const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), hi)

/**
 * Map a unit value to the control's range, matching ControlSpec.map exactly.
 *
 * A UI works in 0..1 and maps through here, which is the normalisation worth
 * having: the range and curve stay declared once, with the SynthDef.
 */
export function mapSpec(spec: ControlSpec, unit: number): number {
  return round(warpMap(spec, clamp(unit, 0, 1)), spec.step)
}

/** The inverse, matching ControlSpec.unmap. */
export function unmapSpec(spec: ControlSpec, value: number): number {
  const lo = Math.min(spec.min, spec.max)
  const hi = Math.max(spec.min, spec.max)
  return warpUnmap(spec, clamp(round(value, spec.step), lo, hi))
}

function warpMap(spec: ControlSpec, unit: number): number {
  const range = spec.max - spec.min

  if (typeof spec.warp === 'number') {
    // CurveWarp. Below 0.001 SuperCollider falls back to linear rather than
    // letting the exponential blow up.
    if (Math.abs(spec.warp) < 0.001) return unit * range + spec.min
    const grow = Math.exp(spec.warp)
    const a = range / (1 - grow)
    return spec.min + a - a * grow ** unit
  }

  switch (spec.warp) {
    case 'linear':
    case 'lin':
      return unit * range + spec.min

    case 'exponential':
    case 'exp':
      // Undefined across or at zero, since it works on the ratio of the bounds.
      if (spec.min === 0 || spec.min * spec.max < 0) {
        throw new RangeError(
          `Control "${spec.name}" is exponential but spans ${spec.min}..${spec.max}; ` +
            `an exponential range cannot include or cross zero.`,
        )
      }
      return (spec.max / spec.min) ** unit * spec.min

    case 'amp':
      // FaderWarp: squared, so a fader has resolution where quiet lives.
      return range > 0
        ? unit * unit * range + spec.min
        : (1 - (1 - unit) ** 2) * range + spec.min

    case 'db': {
      const dbRange = dbamp(spec.max) - dbamp(spec.min)
      return dbRange > 0
        ? ampdb(unit * unit * dbRange + dbamp(spec.min))
        : ampdb((1 - (1 - unit) ** 2) * dbRange + dbamp(spec.min))
    }

    default:
      throw new RangeError(`Unsupported warp "${String(spec.warp)}" on control "${spec.name}"`)
  }
}

function warpUnmap(spec: ControlSpec, value: number): number {
  const range = spec.max - spec.min

  if (typeof spec.warp === 'number') {
    if (Math.abs(spec.warp) < 0.001) return (value - spec.min) / range
    const grow = Math.exp(spec.warp)
    const a = range / (1 - grow)
    const b = spec.min + a
    return Math.log((b - value) / a) / spec.warp
  }

  switch (spec.warp) {
    case 'linear':
    case 'lin':
      return (value - spec.min) / range

    case 'exponential':
    case 'exp':
      return Math.log(value / spec.min) / Math.log(spec.max / spec.min)

    case 'amp':
      return range > 0
        ? Math.sqrt((value - spec.min) / range)
        : 1 - Math.sqrt(1 - (value - spec.min) / range)

    case 'db':
      return Math.sqrt((dbamp(value) - dbamp(spec.min)) / (dbamp(spec.max) - dbamp(spec.min)))

    default:
      throw new RangeError(`Unsupported warp "${String(spec.warp)}" on control "${spec.name}"`)
  }
}

const dbamp = (db: number) => 10 ** (db * 0.05)
const ampdb = (amp: number) => Math.log10(amp) * 20

/** A discrete control — render a stepper or a select, never a continuous fader. */
export const isDiscrete = (spec: ControlSpec): boolean => spec.step >= 1

/** Every value the synth should be sent, before per-event keys are applied. */
export function initialValues(contract: SynthDefContract): Record<string, number> {
  const values: Record<string, number> = {}
  for (const spec of contract.specs) values[spec.name] = spec.default
  for (const frozen of contract.frozen) values[frozen.name] = frozen.value
  return values
}
