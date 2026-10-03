export type OscInt = { type: 'int'; value: number }
export type OscFloat = { type: 'float'; value: number }
export type ControlValue = number | OscInt | OscFloat

/** Force an integer argument, for bufnums, node ids and `/b_*` indices. */
export const i = (value: number): OscInt => {
  if (!Number.isInteger(value)) throw new TypeError(`i() needs an integer, got ${value}`)
  return { type: 'int', value }
}

/** Force a float argument. Rarely needed directly — ctl() does it for you. */
export const f = (value: number): OscFloat => {
  if (!Number.isFinite(value)) throw new TypeError(`f() needs a finite number, got ${value}`)
  return { type: 'float', value }
}

const isWrapped = (value: ControlValue): value is OscInt | OscFloat =>
  typeof value === 'object' && value !== null && 'type' in value

/**
 * Flatten `{ freq: 440 }` into the `name, value, …` pairs scsynth expects,
 * forcing bare numbers to float.
 *
 * This inverts the library's own inference, which types a JS integer as OSC
 * int32 — so `send('/n_set', id, 'freq', 440)` sends an int. Every SynthDef
 * control bus is a float, so the common case should be correct by default and
 * the rare integer case should be the one you spell out with `i()`.
 */
export function ctl(controls: Record<string, ControlValue>): (string | OscInt | OscFloat)[] {
  const out: (string | OscInt | OscFloat)[] = []

  for (const [name, value] of Object.entries(controls)) {
    if (isWrapped(value)) {
      out.push(name, value)
      continue
    }

    if (!Number.isFinite(value)) {
      throw new TypeError(
        `Control "${name}" is ${value}. scsynth would read that as a garbage float; ` +
          `fix the value rather than sending it.`,
      )
    }

    out.push(name, f(value))
  }

  return out
}
