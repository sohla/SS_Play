/**
 * SuperCollider's range mappings, for porting a personality's `~next` verbatim.
 *
 * These live here rather than in a page because they are the instrument: an
 * AirKit personality is mostly a handful of these curves, and every expectation
 * in `test/scmath.test.ts` is sclang's own output rather than anything derived
 * from this file.
 *
 * `mapSpec` and `unmapSpec` in @ss/engine are the same family seen from the
 * other end — those map a 0..1 control onto a SynthDef's declared range, these
 * map a sensor onto whatever a personality asked for.
 */

/**
 * SuperCollider's `lincurve`.
 *
 * A **negative curve bends the output toward `outMax`**, not toward the
 * minimum — the output arrives early and spends most of the input's travel near
 * its far end. Verified rather than assumed: `lincurve(0, -1, 1, 0, 1, -4)` is
 * 0.88, not 0.12. This is why droplet plays across most of the tilt and
 * only falls silent near one end, which is a deliberate shape and the
 * opposite of what the sign suggests.
 */
export function lincurve(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
  curve = -4,
): number {
  const clipped = Math.min(Math.max(value, Math.min(inMin, inMax)), Math.max(inMin, inMax))

  // Below this SuperCollider falls back to linlin, because exp(curve) - 1
  // approaches zero and the division loses all its precision.
  if (Math.abs(curve) < 0.001) {
    return outMin + (outMax - outMin) * ((clipped - inMin) / (inMax - inMin))
  }

  const grow = Math.exp(curve)
  const position = (clipped - inMin) / (inMax - inMin)
  return outMin + (outMax - outMin) * ((1 - grow ** position) / (1 - grow))
}

/** SuperCollider's `linexp`. Exponential in the output, so it cannot cross zero. */
export function linexp(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const clipped = Math.min(Math.max(value, Math.min(inMin, inMax)), Math.max(inMin, inMax))
  return (outMax / outMin) ** ((clipped - inMin) / (inMax - inMin)) * outMin
}

/**
 * SuperCollider's `fold`: reflect back into range rather than clip.
 *
 * Unused in the final mapping and kept because the original's provenance runs
 * through it — `(gyroEvent.x / pi).fold(-0.5, 0.5) * 2` takes a full rotation
 * and reflects it onto -1..1, so rolling past a quarter turn comes back rather
 * than pinning. Our `roll` is a gravity projection, which already reflects —
 * `sin` of the roll angle peaks at 90° and returns — so the fold is inherent
 * rather than applied. That correspondence is close in character and not exact:
 * the original is linear between its reflections, this one is sinusoidal.
 */
export function fold(value: number, lo: number, hi: number): number {
  if (value >= lo && value <= hi) return value
  const span = hi - lo
  const wrapped = (((value - lo) % (2 * span)) + 2 * span) % (2 * span)
  return lo + (wrapped > span ? 2 * span - wrapped : wrapped)
}
