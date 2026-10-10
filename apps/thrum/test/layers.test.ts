import { describe, expect, it } from 'vitest'
import { RESTING, type Motion } from '@ss/motion'
import { REGIMES, SILENCE_BELOW, regimeOf, thrumFrom } from '../src/mapping.ts'

/**
 * The brief, not the plumbing.
 *
 * Every claim this page makes is a claim about a *boundary* — the ~6Hz rate below
 * which events stay separate, the ~25ms duration below which a burst is a tap,
 * the 16/32/80Hz rates at which a pulse train changes category. None of those are
 * visible in the output of a synth and all of them are one arithmetic slip away
 * from being wrong, so they are asserted here where they are cheap.
 *
 * The ranges the assertions compare against are the ones the three SynthDefs
 * declare in their own metadata. Repeated here on purpose: the mapping and the
 * contract are two files that have to agree, and nothing else checks that they
 * do. `sidecar/dist/*.contract.json` has the authoritative copy and is not
 * committed, so importing it would make this suite fail on a fresh clone.
 */

const at = (over: Partial<Motion>): Motion => ({ ...RESTING, live: true, ...over })

/** A sweep of one gesture from nothing to everything. */
const sweep = (key: 'shake' | 'turn', steps = 101) =>
  Array.from({ length: steps }, (_, n) => thrumFrom(at({ [key]: n / (steps - 1) })))

describe('layer 1 — taps stay inside the regime that justifies them', () => {
  // Below about 6.3Hz the pulses of a periodic stimulus can be segregated and
  // counted. That is the only reason this layer is a separate layer, so no
  // gesture may push it out.
  it('never exceeds the ~6.3Hz critical segregation rate, at any sensitivity', () => {
    for (const sens of [0.05, 0.1, 0.25, 0.5, 0.75, 1]) {
      for (let n = 0; n <= 100; n++) {
        const now = thrumFrom(at({ shake: n / 100 }), sens)
        expect(1 / now.dur, `shake ${n / 100} at sens ${sens}`).toBeLessThan(6.3)
      }
    }
  })

  it('shaking harder only ever speeds the taps up', () => {
    const rates = sweep('shake').map((now) => 1 / now.dur)
    for (let n = 1; n < rates.length; n++) {
      expect(rates[n] ?? 0).toBeGreaterThanOrEqual((rates[n - 1] ?? 0) - 1e-9)
    }
  })

  // 25-30ms is where a vibrotactile burst stops being felt as a discrete pulse.
  // A tap is defined by its length here, not by its pitch, so both ends of the
  // decay range have to stay the right side of it.
  it('keeps every tap under the 25ms pulse-to-vibration boundary', () => {
    for (const now of sweep('shake')) {
      expect(now.decay).toBeLessThan(0.025)
      expect(now.decay).toBeGreaterThanOrEqual(0.004)
    }
  })

  it('makes a harder tap sharper rather than longer', () => {
    expect(thrumFrom(at({ shake: 1 })).decay).toBeLessThan(thrumFrom(at({ shake: 0.1 })).decay)
    expect(thrumFrom(at({ shake: 1 })).tapAmp).toBeGreaterThan(thrumFrom(at({ shake: 0.1 })).tapAmp)
  })
})

describe('layer 2 — the rate sweep is the instrument', () => {
  // The page claims one continuous gesture crosses four category boundaries. If
  // the curve or the range drifts, the claim quietly stops being true while
  // everything still makes a noise.
  it('reaches every regime, in order, across one turn of the wrist', () => {
    const seen: string[] = []
    for (const now of sweep('turn')) {
      const name = regimeOf(now.flutRate)
      if (seen[seen.length - 1] !== name) seen.push(name)
    }

    expect(seen).toEqual(REGIMES.map((regime) => regime.name))
  })

  it('crosses the flutter band in the middle of the travel, not at the very end', () => {
    // A boundary you can only reach at full tilt is one you cannot sit on.
    expect(regimeOf(thrumFrom(at({ turn: 0.5 })).flutRate)).toBe('flutter')
  })

  it('stays inside the rate ssp_thrum_bed declares', () => {
    for (const now of sweep('turn')) {
      expect(now.flutRate).toBeGreaterThanOrEqual(4)
      expect(now.flutRate).toBeLessThanOrEqual(90)
      expect(now.flutDecay).toBeLessThan(0.025)
      expect(now.flutAmp).toBeLessThanOrEqual(0.5)
    }
  })
})

describe('layer 3 — the carrier sits on the tactile peak', () => {
  it('covers 250Hz and never leaves the 150..320Hz the def declares', () => {
    const swept = Array.from({ length: 101 }, (_, n) =>
      thrumFrom(at({ roll: n / 50 - 1, pitch: 1, shake: 0.5 })).carFreq,
    )

    expect(Math.min(...swept)).toBeGreaterThanOrEqual(150)
    expect(Math.max(...swept)).toBeLessThanOrEqual(320)
    // The one frequency the page is built around has to be reachable.
    expect(Math.min(...swept)).toBeLessThan(250)
    expect(Math.max(...swept)).toBeGreaterThan(250)
  })

  it('ignores sensitivity, because orientation is absolute', () => {
    const level = at({ roll: 0.4, pitch: 0.3, shake: 0.5 })
    expect(thrumFrom(level, 0.05).carFreq).toBeCloseTo(thrumFrom(level, 1).carFreq, 10)
  })
})

describe('the gestures are separable', () => {
  // Three layers on three gestures is the design. If shaking also opened the
  // flutter, the page would be one gesture wearing three names — and it would
  // still sound busy, which is why this is a test rather than a listen.
  it('shaking hard does not raise the flutter', () => {
    const shaken = thrumFrom(at({ shake: 1 }))
    expect(shaken.flutAmp).toBe(0)
    expect(regimeOf(shaken.flutRate)).toBe('discrete')
  })

  it('turning hard does not strike a tap', () => {
    const turned = thrumFrom(at({ turn: 1 }))
    expect(turned.strike).toBe(0)
    // The clock's second gate. Below this it spawns nothing, so turning alone
    // cannot cost a node.
    expect(turned.strike).toBeLessThan(0.02)
  })

  it('tilting alone makes no sound at all', () => {
    // The one gesture that does not return to zero on its own. A phone propped
    // on a desk is a valid pitch and must still be silent.
    const propped = thrumFrom(at({ pitch: 1, roll: 0.5 }))
    expect(propped.carAmp).toBe(0)
    expect(propped.level).toBeLessThan(SILENCE_BELOW)
  })

  it('still lets a small movement open the bed that tilt has set up', () => {
    expect(thrumFrom(at({ pitch: 1, turn: 0.4 })).carAmp).toBeGreaterThan(0.2)
  })
})

describe('excursion is zero-sum', () => {
  // The physical claim underneath the whole page: three layers are three claims
  // on the same diaphragm travel, so a hard tap has to take its headroom from
  // somewhere rather than be added on top.
  it('ducks the bed in proportion to how hard the taps are striking', () => {
    const quiet = thrumFrom(at({ turn: 0.6, pitch: 1, shake: 0 }))
    const struck = thrumFrom(at({ turn: 0.6, pitch: 1, shake: 1 }))

    expect(struck.duck).toBeLessThan(quiet.duck)
    expect(struck.bedAmp).toBeLessThan(quiet.bedAmp)
  })

  it('takes the headroom off the master and not off the two layer levels', () => {
    // The split the bed's `amp` exists for: `flutAmp` and `carAmp` are what the
    // gesture asked for and must not move when a tap lands, because the plotter
    // reads them and a demand trace that dipped every time the hand struck
    // would be showing the budget rather than the gesture.
    const quiet = thrumFrom(at({ turn: 0.6, pitch: 1, shake: 0 }))
    const struck = thrumFrom(at({ turn: 0.6, pitch: 1, shake: 1 }))

    expect(struck.flutAmp).toBeCloseTo(quiet.flutAmp, 10)
    expect(struck.carAmp).toBeGreaterThanOrEqual(quiet.carAmp)
  })

  it('never ducks the bed away entirely', () => {
    // Ducking to zero would make a hard shake mute the other two layers, which
    // is a mode change rather than a mix.
    expect(thrumFrom(at({ shake: 1 })).duck).toBeGreaterThan(0.3)
    expect(thrumFrom(at({ shake: 1 })).bedAmp).toBeGreaterThan(0.25)
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
    // Yellow is the tap layer: the lead, and the accent colour.
    expect(now.drive[0]).toBeCloseTo(now.strike, 10)
  })
})

describe('a resting phone', () => {
  it('is below the clock threshold the SynthDef compares against', () => {
    expect(thrumFrom(RESTING).level).toBeLessThan(SILENCE_BELOW)
  })

  it('still reports a usable carrier frequency rather than zero', () => {
    // The bed is silent, not detuned. A carFreq of 0 reaching a lagged SinOsc
    // would slide the pitch up from nothing on the first movement.
    expect(thrumFrom(RESTING).carFreq).toBeGreaterThan(150)
  })
})
