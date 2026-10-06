import { lincurve, type Motion } from '@ss/motion'
import type { Mapped } from '@ss/ui'

/**
 * melChair3's `~next`, in TypeScript.
 *
 *   dur = rrateMassFiltered.lincurve(0, 1, 0.4, 0.04, -3)
 *   play while rrateMassFiltered > 0.2, pause otherwise
 *
 * One mapping and a threshold — the whole personality. What makes it play is
 * the sequence underneath, which runs in the SynthDef.
 *
 * `rrateMassFiltered` is AirKit's smoothed rotation-rate magnitude: how fast
 * the stick is turning, regardless of which way. Our substitute is the rate of
 * change of orientation, which is the same quantity by a different route.
 */
export const SILENCE_BELOW = 0.2

export function mapMelChair(motion: Motion): Mapped {
  const turnRate = motion.turn
  const dur = lincurve(turnRate, 0, 1, 0.4, 0.04, -3)

  return {
    dur,
    level: turnRate,
    voice: {},
    traces: [
      { label: 'turn', hint: 'rate — and whether it plays at all', value: turnRate * 2 - 1 },
      { label: 'roll', hint: 'unused by this personality', value: motion.roll },
    ],
    values: [
      ['dur', `${dur.toFixed(3)}s`],
      ['turn', turnRate.toFixed(3)],
    ],
  }
}
