import { lincurve, type Motion } from '@ss/motion'
import type { Mapped } from '@ss/ui'

/**
 * multiBeatSynth1's `~next`, in TypeScript.
 *
 *   idx       = accelMassFiltered.lincurve(0, 1.5, 0, 2, 1).round.clip(0, 2)
 *   amp       = accelMassFiltered.lincurve(0, 1.0, -40, -10, -1)
 *   ffreq     = accelMassFiltered.lincurve(0, 1.0, 700,  6000, 2)
 *   rel       = accelMassFiltered.lincurve(0, 1.0, 0.1,  1.2,  2)
 *   droneAmp  = accelMassFiltered.lincurve(0, 2.0, -32, -10, -1)
 *   droneFreq = accelMassFiltered.lincurve(0, 1.0, 500,  3000, 2)
 *
 * One number drives everything, and `idx` is the interesting one: it selects a
 * subdivision rather than a value, so moving the hand changes how a half-second
 * bar is cut up — one note, two or four — rather than how fast it runs. Metric
 * modulation by movement.
 */
export const SILENCE_BELOW = 0.02

/** Subdivisions of the bar, and the pool the notes come from. */
export const DIVS = [1, 2, 4] as const
export const POOL = [0, 4, 7, 11, 12, 11, 7, 2] as const
export const BAR_S = 0.5
export const DRONE_NOTE = 24

const dbamp = (db: number) => 10 ** (db * 0.05)

export interface MultiBeat {
  divIdx: number
  amp: number
  ffreq: number
  release: number
  droneAmp: number
  droneFfreq: number
}

export function multiBeatFrom(motion: Motion): MultiBeat {
  const mass = motion.shake * 2

  let ampDb = lincurve(mass, 0, 1, -40, -10, -1)
  let droneDb = lincurve(mass, 0, 2, -32, -10, -1)
  // The original's two floors. Below them it does not fade, it stops — which is
  // what makes holding the phone still a gesture rather than a quiet passage.
  if (ampDb < -39) ampDb = -90
  if (droneDb < -31) droneDb = -90

  return {
    divIdx: Math.min(Math.max(Math.round(lincurve(mass, 0, 1.5, 0, DIVS.length - 1, 1)), 0), DIVS.length - 1),
    amp: dbamp(ampDb),
    ffreq: lincurve(mass, 0, 1, 700, 6000, 2),
    release: lincurve(mass, 0, 1, 0.1, 1.2, 2),
    droneAmp: dbamp(droneDb),
    droneFfreq: lincurve(mass, 0, 1, 500, 3000, 2),
  }
}

export function mapMultiBeat(motion: Motion): Mapped {
  const now = multiBeatFrom(motion)

  return {
    // The pattern decides its own step, so this is only here for the display.
    dur: BAR_S / DIVS[now.divIdx]!,
    level: motion.shake,
    voice: {},
    held: { amp: now.droneAmp, ffreq: now.droneFfreq },
    traces: [
      { label: 'move', hint: 'subdivision, level, filter', value: motion.shake * 2 - 1 },
    ],
    values: [
      ['notes/bar', String(DIVS[now.divIdx])],
      ['step', `${(BAR_S / DIVS[now.divIdx]!).toFixed(3)}s`],
      ['amp', now.amp.toFixed(4)],
      ['ffreq', `${now.ffreq.toFixed(0)}Hz`],
      ['release', `${now.release.toFixed(2)}s`],
      ['drone', now.droneAmp.toFixed(4)],
    ],
  }
}
