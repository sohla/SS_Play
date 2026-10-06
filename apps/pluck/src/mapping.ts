import type { Motion } from '@ss/motion'
import type { Mapped } from '@ss/ui'

/**
 * pluck1's `~next`, in TypeScript.
 *
 *   amp = accelMassFiltered.linlin(0, 2.5 * sens, 0.07, 1)
 *   pch = 40  + accelMass * 150 * (1 - sens)
 *   frq = 110 + accelMassFiltered * 100 * (1 - sens)
 *   amp = 0 when accelMass < 0.1
 *
 * `sens` is a per-device sensitivity knob in AirKit's GUI. There is no GUI
 * here, so it is fixed at the midpoint — which is the one number in this file
 * that is a choice rather than a port, and the obvious thing to expose if the
 * instrument wants adjusting by hand later.
 *
 * Note the two different inputs: `pch` reads the raw mass and `amp` reads the
 * filtered one, so the pitch jumps with every knock while the level follows
 * more slowly. That difference is the instrument.
 */
export const SILENCE_BELOW = 0.1

const SENSITIVITY = 0.5

const linlin = (v: number, a: number, b: number, c: number, d: number) =>
  c + ((d - c) * (Math.min(Math.max(v, a), b) - a)) / (b - a)

export function mapPluck(motion: Motion): Mapped {
  // `shake` rises instantly and falls slowly, which is AirKit's accelMass and
  // accelMassFiltered in one number. The raw peak is the better stand-in for
  // the unfiltered one.
  const raw = Math.max(Math.abs(motion.accelX), Math.abs(motion.accelY), Math.abs(motion.accelZ))
  const filtered = motion.shake

  const scale = linlin(SENSITIVITY, 0, 1, 1, 0)
  const pch = 40 + raw * 2.5 * 150 * scale
  const frq = 110 + filtered * 2.5 * 100 * scale
  const amp = raw < 0.1 ? 0 : linlin(filtered * 2.5, 0, 2.5 * SENSITIVITY, 0.07, 1)

  return {
    dur: 0,
    level: raw,
    voice: { amp, pch, frq },
    traces: [
      { label: 'knock', hint: 'pitch — reads the raw peak', value: raw * 2 - 1 },
      { label: 'move', hint: 'string length, level', value: filtered * 2 - 1 },
    ],
    values: [
      ['pch', pch.toFixed(1)],
      ['frq', `${frq.toFixed(1)}Hz`],
      ['amp', amp.toFixed(3)],
    ],
  }
}
