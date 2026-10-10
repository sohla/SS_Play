import { describe, expect, it } from 'vitest'
import { RESTING, type Motion } from '@ss/motion'
import {
  DEFAULT_CONTROLS,
  RANGES,
  REGIMES,
  SILENCE_BELOW,
  TAP_BOUNDARY_S,
  pulseReads,
  regimeOf,
  thrumFrom,
  widthReads,
  type Controls,
} from '../src/mapping.ts'

/**
 * The brief, not the plumbing.
 *
 * Two kinds of claim here, and the second kind is newer and turned out to matter
 * more.
 *
 * **Boundaries.** The ~6Hz rate below which taps stay countable, the ~25ms
 * duration at which a burst stops being a tap, the five regimes one turn of the
 * wrist has to cross. Arithmetic, one slip from being wrong, and invisible in the
 * output of a synth — so they are asserted here, where they are cheap.
 *
 * **Independence.** Every layer's pitch and length must be its own. This is where
 * the page kept going wrong: three separate things were shared because sharing
 * them was defensible on paper, and each one removed a question the instrument
 * needed to be able to ask. A suite that only checked ranges passed happily
 * through all three.
 *
 * The ranges below are the ones the three SynthDefs declare in their metadata,
 * repeated on purpose: the mapping and the contract have to agree and nothing
 * else checks that they do. `sidecar/dist/*.contract.json` holds the
 * authoritative copy and is not committed, so importing it would break a fresh
 * clone.
 */

const at = (over: Partial<Motion>): Motion => ({ ...RESTING, live: true, ...over })

const sweep = (key: 'shake' | 'turn', steps = 101) =>
  Array.from({ length: steps }, (_, n) => thrumFrom(at({ [key]: n / (steps - 1) })))

const withControls = (over: Partial<Controls>): Controls => ({ ...DEFAULT_CONTROLS, ...over })

describe('every layer owns its own pitch', () => {
  // The correction that mattered most. The flutter and the carrier shared one
  // oscillator, and the taps took their pitch from the carrier through a
  // sequence of ratios — so two of the three layers had no pitch of their own,
  // and there was no way to ask whether the rate that feels right and the
  // frequency that feels right are the same answer.
  it('moves one pitch without moving the others', () => {
    const base = thrumFrom(RESTING, 0.5, withControls({ freeRun: true }))

    const tapOnly = thrumFrom(RESTING, 0.5, withControls({ freeRun: true, tapPitch: 120 }))
    expect(tapOnly.tapFreq).toBeCloseTo(120, 6)
    expect(tapOnly.flutFreq).toBeCloseTo(base.flutFreq, 6)
    expect(tapOnly.carFreq).toBeCloseTo(base.carFreq, 6)

    const flutOnly = thrumFrom(RESTING, 0.5, withControls({ freeRun: true, flutPitch: 400 }))
    expect(flutOnly.flutFreq).toBeCloseTo(400, 6)
    expect(flutOnly.tapFreq).toBeCloseTo(base.tapFreq, 6)
    expect(flutOnly.carFreq).toBeCloseTo(base.carFreq, 6)

    const carOnly = thrumFrom(RESTING, 0.5, withControls({ freeRun: true, carPitch: 90 }))
    expect(carOnly.carFreq).toBeCloseTo(90, 6)
    expect(carOnly.tapFreq).toBeCloseTo(base.tapFreq, 6)
    expect(carOnly.flutFreq).toBeCloseTo(base.flutFreq, 6)
  })

  it('reaches well outside 250Hz on all three, because an average is not a hand', () => {
    for (const key of ['tapPitch', 'flutPitch', 'carPitch'] as const) {
      expect(RANGES[key].min).toBeLessThan(150)
      expect(RANGES[key].max).toBeGreaterThan(500)
    }
  })

  it('clamps every pitch into the range the defs declare', () => {
    for (const value of [-100, 0, 10, 5000]) {
      const now = thrumFrom(
        at({ roll: 1 }),
        0.5,
        withControls({ tapPitch: value, flutPitch: value, carPitch: value }),
      )
      for (const freq of [now.tapFreq, now.flutFreq, now.carFreq]) {
        expect(freq).toBeGreaterThanOrEqual(60)
        expect(freq).toBeLessThanOrEqual(600)
      }
    }
  })
})

describe('every layer owns its own length', () => {
  it('moves one length without moving the other', () => {
    const now = thrumFrom(RESTING, 0.5, withControls({ tapLength: 0.3, flutLength: 0.005 }))
    expect(now.tapLength).toBeCloseTo(0.3, 10)
    expect(now.flutLength).toBeCloseTo(0.005, 10)

    const swapped = thrumFrom(RESTING, 0.5, withControls({ tapLength: 0.005, flutLength: 0.3 }))
    expect(swapped.tapLength).toBeCloseTo(0.005, 10)
    expect(swapped.flutLength).toBeCloseTo(0.3, 10)
  })

  // This used to assert both lengths stayed under 25ms, on the grounds that
  // length is what makes a tap a tap. A hand could not feel the result: the
  // Pacinian channel summates energy over time up to about a second, so a burst
  // short enough to be unambiguously a tap sits where that channel is least
  // sensitive. The assertion is now the opposite shape — the control has to
  // *reach* both sides, because which side is right is not knowable here.
  it('reaches both sides of the tap/vibration boundary', () => {
    for (const key of ['tapLength', 'flutLength'] as const) {
      expect(RANGES[key].min).toBeLessThan(TAP_BOUNDARY_S)
      expect(RANGES[key].max).toBeGreaterThan(TAP_BOUNDARY_S * 4)
    }
    expect(pulseReads(RANGES.tapLength.min)).toBe('tap')
    expect(pulseReads(RANGES.tapLength.max)).toBe('buzz')
  })

  it('takes both lengths from the controls and never from a gesture', () => {
    // A duration being judged must not also be moving. The first version drove
    // tap length from the gesture, so feeling harder for a tap shortened it.
    const gentle = thrumFrom(at({ shake: 0.1, turn: 0.1 }), 0.5, withControls({ tapLength: 0.08 }))
    const hard = thrumFrom(at({ shake: 1, turn: 1 }), 0.5, withControls({ tapLength: 0.08 }))
    expect(gentle.tapLength).toBeCloseTo(hard.tapLength, 10)
    expect(gentle.flutLength).toBeCloseTo(hard.flutLength, 10)
  })
})

describe('the rates still do what the page is about', () => {
  it('never pushes the taps past the ~6.3Hz segregation rate, at any sensitivity', () => {
    for (const sens of [0.05, 0.1, 0.25, 0.5, 0.75, 1]) {
      for (let n = 0; n <= 100; n++) {
        const now = thrumFrom(at({ shake: n / 100 }), sens)
        expect(1 / now.dur, `shake ${n / 100} at sens ${sens}`).toBeLessThan(6.3)
      }
    }
    // And the free-run slider cannot either.
    expect(RANGES.tapRate.max).toBeLessThan(6.3)
  })

  it('crosses every regime, in order, across one turn of the wrist', () => {
    const seen: string[] = []
    for (const now of sweep('turn')) {
      const name = regimeOf(now.flutRate)
      if (seen[seen.length - 1] !== name) seen.push(name)
    }
    expect(seen).toEqual(REGIMES.map((regime) => regime.name))
  })

  it('puts the flutter band in the middle of the travel, not at the very end', () => {
    expect(regimeOf(thrumFrom(at({ turn: 0.5 })).flutRate)).toBe('flutter')
  })

  it('keeps every free-run rate inside the specs the defs declare', () => {
    for (const tapRate of [RANGES.tapRate.min, 3, RANGES.tapRate.max]) {
      for (const flutRate of [RANGES.flutRate.min, 40, RANGES.flutRate.max]) {
        const now = thrumFrom(RESTING, 0.5, withControls({ freeRun: true, tapRate, flutRate }))
        expect(now.dur).toBeGreaterThanOrEqual(0.12)
        expect(now.dur).toBeLessThanOrEqual(1.4)
        expect(now.flutRate).toBeGreaterThanOrEqual(4)
        expect(now.flutRate).toBeLessThanOrEqual(90)
      }
    }
  })
})

describe('the shape controls, which are shared on purpose', () => {
  // Width, attack and click describe the waveform rather than a layer, so these
  // are the three that *should* be global. Asserted so the difference between
  // "shared by accident" and "shared deliberately" is written down somewhere.
  it('reaches a square at one end and a spike at the other', () => {
    expect(RANGES.width.max).toBe(0.5)
    expect(RANGES.width.min).toBeLessThan(0.05)
    expect(widthReads(0.5)).toBe('fat, felt')
    expect(widthReads(0.02)).toBe('thin, heard')
  })

  it('never lets a width out of the range Pulse is given', () => {
    // Pulse at 0 or 1 is a DC line rather than an oscillator, so the clamp is
    // load-bearing rather than defensive.
    for (const width of [-5, 0, 0.75, 1, 99]) {
      const now = thrumFrom(RESTING, 0.5, withControls({ width }))
      expect(now.width).toBeGreaterThanOrEqual(RANGES.width.min)
      expect(now.width).toBeLessThanOrEqual(RANGES.width.max)
    }
  })

  it('defaults to a square, the most felt setting available', () => {
    // The page was reported as not arriving, and a sine wastes more headroom
    // than any other option here. The default should not be the weakest one.
    expect(DEFAULT_CONTROLS.width).toBe(RANGES.width.max)
  })

  it('can take the onset from a click to a swell', () => {
    expect(RANGES.attack.min).toBeLessThan(0.0005)
    expect(RANGES.attack.max).toBeGreaterThan(0.05)
    const sharp = thrumFrom(RESTING, 0.5, withControls({ attack: 0.0002 }))
    const soft = thrumFrom(RESTING, 0.5, withControls({ attack: 0.06 }))
    expect(soft.attack / sharp.attack).toBeGreaterThan(100)
  })

  it('can switch the audible tick off entirely', () => {
    // Zero is a legitimate setting, not a floor to clamp away from. The tick
    // exists so a felt event can be placed in time; with nothing felt it is the
    // only thing arriving, which is what "still producing glitches" described.
    expect(RANGES.click.min).toBe(0)
    expect(thrumFrom(RESTING, 0.5, withControls({ click: 0 })).clickAmp).toBe(0)
  })

  it('can silence the whole page from the drive control', () => {
    const dead = thrumFrom(at({ shake: 1, turn: 1, pitch: 1 }), 0.5, withControls({ drive: 0 }))
    expect(dead.tapAmp).toBe(0)
    expect(dead.bedAmp).toBe(0)
  })
})

describe('nothing is derived from anything else any more', () => {
  // The duck is gone. The taps used to pull the bed down as the hand struck
  // harder, on the argument that excursion is zero-sum. The argument is right
  // and the control was wrong: a level that moves while you are trying to judge
  // a level is exactly what makes a page impossible to tune.
  it('holds the bed level still however hard the taps strike', () => {
    const quiet = thrumFrom(at({ turn: 0.6, pitch: 1, shake: 0 }))
    const struck = thrumFrom(at({ turn: 0.6, pitch: 1, shake: 1 }))
    expect(struck.bedAmp).toBeCloseTo(quiet.bedAmp, 10)
  })

  it('changes exactly one output per control, across every pitch and length', () => {
    // The assertion the three shared-control bugs would all have failed. Range
    // checks passed through every one of them; this does not.
    const keys = ['tapPitch', 'tapLength', 'flutPitch', 'flutLength', 'carPitch'] as const
    const reads = (controls: Controls) => {
      const now = thrumFrom(RESTING, 0.5, controls)
      return [now.tapFreq, now.tapLength, now.flutFreq, now.flutLength, now.carFreq]
    }
    const base = reads(withControls({ freeRun: true }))

    keys.forEach((key, index) => {
      const moved = reads(
        withControls({ freeRun: true, [key]: key.endsWith('Length') ? 0.2 : 333 }),
      )
      const differing = moved.filter((value, n) => Math.abs(value - (base[n] ?? 0)) > 1e-9).length
      expect(differing, `moving ${key} moved ${differing} outputs`).toBe(1)
      expect(moved[index]).not.toBeCloseTo(base[index] ?? 0, 6)
    })
  })
})

describe('the gestures are separable', () => {
  it('shaking hard does not raise the flutter', () => {
    const shaken = thrumFrom(at({ shake: 1 }))
    expect(shaken.flutAmp).toBe(0)
    expect(regimeOf(shaken.flutRate)).toBe('discrete')
  })

  it('turning hard does not strike a tap', () => {
    const turned = thrumFrom(at({ turn: 1 }))
    expect(turned.strike).toBe(0)
    expect(turned.strike).toBeLessThan(0.02)
  })

  it('tilting alone makes no sound at all', () => {
    const propped = thrumFrom(at({ pitch: 1, roll: 0.5 }))
    expect(propped.carAmp).toBe(0)
    expect(propped.level).toBeLessThan(SILENCE_BELOW)
  })
})

describe('free run and the mutes', () => {
  it('sounds with the phone completely still', () => {
    const still = thrumFrom(RESTING, 0.5, withControls({ freeRun: true }))
    expect(still.level).toBeGreaterThan(SILENCE_BELOW)
    expect(still.strike).toBeGreaterThan(0.02)
    expect(still.carAmp).toBeGreaterThan(0)
  })

  it('makes every slider exact, with no gesture modulating it', () => {
    // The one rule. In gesture mode roll offsets the carrier; in free run the
    // slider is the number, so a reading can be repeated.
    const rolled = thrumFrom(at({ roll: 1 }), 0.5, withControls({ freeRun: true, carPitch: 200 }))
    const flat = thrumFrom(at({ roll: -1 }), 0.5, withControls({ freeRun: true, carPitch: 200 }))
    expect(rolled.carFreq).toBeCloseTo(200, 6)
    expect(flat.carFreq).toBeCloseTo(200, 6)
  })

  it('still lets roll offset the carrier in gesture mode', () => {
    const up = thrumFrom(at({ roll: 1, turn: 0.4, pitch: 1 }), 0.5, withControls({ carPitch: 250 }))
    const down = thrumFrom(
      at({ roll: -1, turn: 0.4, pitch: 1 }),
      0.5,
      withControls({ carPitch: 250 }),
    )
    expect(up.carFreq).toBeGreaterThan(down.carFreq)
  })

  it('mutes the taps by stopping the clock, not by silencing the voice', () => {
    // A muted layer must cost no nodes. Silencing the voice would still spawn
    // one per beat, which is what the clock's second gate exists to avoid.
    const muted = thrumFrom(at({ shake: 1 }), 0.5, withControls({ muteTaps: true }))
    expect(muted.strike).toBe(0)
  })

  it('mutes each of the other two layers independently', () => {
    const loud = at({ turn: 0.6, pitch: 1 })
    expect(thrumFrom(loud, 0.5, withControls({ muteFlutter: true })).flutAmp).toBe(0)
    expect(thrumFrom(loud, 0.5, withControls({ muteFlutter: true })).carAmp).toBeGreaterThan(0)
    expect(thrumFrom(loud, 0.5, withControls({ muteCarrier: true })).carAmp).toBe(0)
    expect(thrumFrom(loud, 0.5, withControls({ muteCarrier: true })).flutAmp).toBeGreaterThan(0)
  })

  it('opens in gesture mode with nothing muted', () => {
    expect(DEFAULT_CONTROLS.freeRun).toBe(false)
    expect(DEFAULT_CONTROLS.muteTaps).toBe(false)
    expect(DEFAULT_CONTROLS.muteFlutter).toBe(false)
    expect(DEFAULT_CONTROLS.muteCarrier).toBe(false)

    const implicit = thrumFrom(at({ shake: 0.6, turn: 0.4, pitch: 0.5 }))
    const explicit = thrumFrom(at({ shake: 0.6, turn: 0.4, pitch: 0.5 }), 0.5, DEFAULT_CONTROLS)
    expect(implicit).toEqual(explicit)
  })
})

describe('the plot shows what the mapping reads', () => {
  it('reports one 0..1 drive per layer, in the order of the labels', () => {
    const now = thrumFrom(at({ shake: 0.8, turn: 0.3, pitch: 1 }))
    expect(now.drive).toHaveLength(3)
    for (const value of now.drive) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
    expect(now.drive[0]).toBeCloseTo(now.strike, 10)
  })
})
