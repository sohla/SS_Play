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
 * `sens` is AirKit's per-device sensitivity knob, and this is one of only four
 * personalities that reads it — so unlike the other pages here, where the control
 * is an addition, these three uses are the port. Note that two of them are
 * *inverted*: `sens.linlin(0, 1, 1, 0)` means a higher sensitivity reduces the
 * pitch and filter travel while increasing the level's.
 *
 * Note the two different inputs: `pch` reads the raw mass and `amp` reads the
 * filtered one, so the pitch jumps with every knock while the level follows
 * more slowly. That difference is the instrument.
 */
export const SILENCE_BELOW = 0.1

const linlin = (v: number, a: number, b: number, c: number, d: number) =>
  c + ((d - c) * (Math.min(Math.max(v, a), b) - a)) / (b - a)

export function mapPluck(motion: Motion, sensitivity = 0.5): Mapped {
  // `shake` rises instantly and falls slowly, which is AirKit's accelMass and
  // accelMassFiltered in one number. The raw peak is the better stand-in for
  // the unfiltered one.
  // A stand-in from before `shakeRaw` existed. `motion.shakeRaw` is now the
  // actual unfiltered magnitude and would be the more faithful reading — left
  // alone because swapping it changes how the instrument sounds, which is not
  // what adding a sensitivity control is for.
  const raw = Math.max(Math.abs(motion.accelX), Math.abs(motion.accelY), Math.abs(motion.accelZ))
  const filtered = motion.shake

  const scale = linlin(sensitivity, 0, 1, 1, 0)
  const pch = 40 + raw * 2.5 * 150 * scale
  const frq = 110 + filtered * 2.5 * 100 * scale
  const amp = raw < 0.1 ? 0 : linlin(filtered * 2.5, 0, 2.5 * Math.max(0.05, sensitivity), 0.07, 1)

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

/**
 * pluck1.sc's `~plot`, ported.
 *
 *   [m.accelMassFiltered * 0.1, d.sensors.gyroEvent.x * 0.1]
 *
 * The plotter polls this at 33Hz and keeps fifty frames, so these are the values
 * the mapping actually feeds its curves with a second and a half of history —
 * which is the readout that makes a gesture doing nothing visible.
 */
export function plotOf(motion: Motion): number[] {
  return [motion.shake * 0.1, motion.roll * 0.1]
}

/** The series in colour order: yellow, magenta, cyan. */
export const PLOT_LABELS = ['move x0.1', 'roll x0.1']
