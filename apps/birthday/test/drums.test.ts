import { describe, expect, it } from 'vitest'
import {
  KICK_AMP,
  ROLLS_ABOVE,
  TICKS_PER_STEP,
  chance,
  drumsAt,
  freshDrummer,
  type Kit,
} from '../src/drums.ts'
import { HAPPY_BIRTHDAY } from '../src/happy-birthday.ts'
import { RESTING_GESTURE } from '../src/mapping.ts'

const P = HAPPY_BIRTHDAY
const KIT: Kit = { kick: 1, snares: [2, 3, 4], hats: [5, 6], crash: 7 }
/**
 * A real-magnitude start, so the hash sees the step numbers a phone will — and
 * on the top of the loop, so tick 0 here is a downbeat of the song.
 */
const FROM =
  Math.floor(1_760_000_000_000 / P.stepMs / P.loopSteps) * P.loopSteps * TICKS_PER_STEP

/** Every hit over some bars at a fixed energy, with the tick each landed on. */
function play(energy: number, bars = 16, drumRate = 1) {
  const state = freshDrummer()
  const gesture = { ...RESTING_GESTURE, energy, drumRate }
  const hits: { tick: number; bufnum: number; rate: number; cutoff: number; amp: number }[] = []
  for (let n = 0; n < bars * P.stepsPerBar * TICKS_PER_STEP; n++) {
    for (const event of drumsAt(P, FROM + n, gesture, KIT, state)) {
      expect(event.def).toBe('ssp_kit')
      expect(event.sustain).toBeGreaterThan(0)
      hits.push({
        tick: n,
        bufnum: event.controls.bufnum as number,
        rate: event.controls.rate as number,
        cutoff: event.controls.cutoff as number,
        amp: event.controls.amp as number,
      })
    }
  }
  return hits
}

describe('the drums', () => {
  it('are silent while the phone is still', () => {
    expect(play(0)).toHaveLength(0)
  })

  it('play a plain waltz break at low energy: on the sixteenths, kick on every downbeat', () => {
    const hits = play(0.15)
    for (const one of hits) expect(one.tick % TICKS_PER_STEP).toBe(0)
    const bar = P.stepsPerBar * TICKS_PER_STEP
    for (let downbeat = 0; downbeat < 16 * bar; downbeat += bar) {
      expect(hits.some((one) => one.tick === downbeat && one.bufnum === KIT.kick)).toBe(true)
    }
    expect(hits.some((one) => one.rate !== 1)).toBe(false)
  })

  it('cut finer as energy rises: more hits, and more of them between the sixteenths', () => {
    const between = (energy: number) => play(energy).filter((one) => one.tick % TICKS_PER_STEP).length
    const total = (energy: number) => play(energy).length
    expect(total(0.6)).toBeGreaterThan(total(0.15))
    expect(total(0.95)).toBeGreaterThan(total(0.6))
    expect(between(0.95)).toBeGreaterThan(0)
  })

  it('keep to the sixteenths until there is a lot of energy', () => {
    for (const energy of [0.15, 0.4, 0.6, ROLLS_ABOVE]) {
      expect(play(energy, 32).filter((one) => one.tick % TICKS_PER_STEP), `at ${energy}`).toHaveLength(0)
    }
  })

  it('keep the kick loud and steady whatever the energy', () => {
    for (const energy of [0.1, 0.5, 0.99]) {
      const kicks = play(energy).filter((one) => one.bufnum === KIT.kick)
      expect(kicks.length).toBeGreaterThan(0)
      for (const kick of kicks) expect(kick.amp).toBe(KICK_AMP)
    }
  })

  it('retune with yaw, all but the kick', () => {
    for (const rate of [0.5, 2]) {
      const hits = play(0.6, 4, rate)
      for (const one of hits) {
        if (one.bufnum === KIT.kick) expect(one.rate).toBe(1)
        // Zaps carry their own random pitch on top; everything else is the
        // yaw rate, or 1.1 times it for a ghost snare.
        else if (one.cutoff < 1000) {
          expect([rate, 1.1 * rate].some((r) => Math.abs(one.rate - r) < 1e-9)).toBe(true)
        }
      }
    }
  })

  it('roll at one tick apart only at the very top', () => {
    const gaps = (energy: number) => {
      const ticks = play(energy).map((one) => one.tick)
      return new Set(ticks.slice(1).map((tick, n) => tick - (ticks[n] as number)))
    }
    expect(gaps(0.9).has(1)).toBe(false)
    expect(gaps(0.99).has(1)).toBe(true)
  })

  it('glitch at high energy: zaps, bent and reversed hits', () => {
    const hits = play(0.99, 32)
    expect(hits.some((one) => one.cutoff > 1000), 'no resonant zaps').toBe(true)
    expect(hits.some((one) => one.rate < 0), 'no reversed stutter').toBe(true)
    expect(hits.some((one) => one.rate > 1.4), 'no pitched-up roll').toBe(true)
  })

  it('cut the same break on every device', () => {
    expect(play(0.9)).toEqual(play(0.9))
  })
})

describe('chance', () => {
  it('spreads evenly across 0..1 at real step magnitudes', () => {
    const start = Math.floor(1_760_000_000_000 / P.stepMs)
    const buckets = new Array(10).fill(0)
    for (let n = 0; n < 10_000; n++) buckets[Math.floor(chance(start + n, 6) * 10)]++
    for (const count of buckets) expect(count).toBeGreaterThan(850)
    for (const count of buckets) expect(count).toBeLessThan(1150)
  })
})
