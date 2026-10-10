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
  type Controls,
} from '../src/mapping.ts'

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

const withControls = (over: Partial<Controls>): Controls => ({ ...DEFAULT_CONTROLS, ...over })

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

  // This used to assert decay stayed under 25ms at every gesture, on the grounds
  // that length is what makes a tap a tap. It was reported unfeelable by a hand,
  // and the reason is the other half of the research: the Pacinian channel
  // summates energy over time up to about a second, so a burst short enough to
  // be unambiguously a tap is also close to undetectable.
  //
  // So the assertion is now the opposite shape. The control must *reach* both
  // sides of the boundary, because which side is right is not a thing this file
  // can know.
  it('lets the pulse reach both sides of the boundary', () => {
    expect(RANGES.pulse.min).toBeLessThan(TAP_BOUNDARY_S)
    expect(RANGES.pulse.max).toBeGreaterThan(TAP_BOUNDARY_S * 4)

    expect(pulseReads(RANGES.pulse.min)).toBe('tap')
    expect(pulseReads(RANGES.pulse.max)).toBe('buzz')
  })

  it('takes the pulse from the control and not from the gesture', () => {
    // A duration you are trying to judge must not also be moving. In the first
    // version shaking harder shortened the very thing being felt for, so the
    // harder you looked the less there was to find.
    const gentle = thrumFrom(at({ shake: 0.1 }), 0.5, withControls({ pulse: 0.08 }))
    const hard = thrumFrom(at({ shake: 1 }), 0.5, withControls({ pulse: 0.08 }))

    expect(gentle.decay).toBeCloseTo(0.08, 10)
    expect(hard.decay).toBeCloseTo(0.08, 10)
  })

  it('still makes a harder tap louder', () => {
    expect(thrumFrom(at({ shake: 1 })).tapAmp).toBeGreaterThan(thrumFrom(at({ shake: 0.1 })).tapAmp)
  })

  it('gives the flutter the same pulse length, since one hand judges one burst', () => {
    const now = thrumFrom(at({ turn: 0.5 }), 0.5, withControls({ pulse: 0.05 }))
    expect(now.flutDecay).toBeCloseTo(now.decay, 10)
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
      // The def's declared range, which now spans the tap/buzz boundary rather
      // than stopping below it.
      expect(now.flutDecay).toBeGreaterThanOrEqual(RANGES.pulse.min)
      expect(now.flutDecay).toBeLessThanOrEqual(RANGES.pulse.max)
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

    // Relative, not absolute. `bedAmp` also carries the drive control now, so a
    // fixed floor here would be asserting the default drive rather than the
    // ducking — and would fail the moment someone turned the page down.
    const quiet = thrumFrom(at({ turn: 0.6, pitch: 1, shake: 0 })).bedAmp
    const struck = thrumFrom(at({ turn: 0.6, pitch: 1, shake: 1 })).bedAmp
    expect(struck / quiet).toBeGreaterThan(0.3)
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


describe('the controls a hand needs', () => {
  it('sounds with the phone completely still when free-running', () => {
    // The control that makes the others usable. Judging a vibration while
    // shaking the device producing it is close to impossible, so free run has to
    // open the clock gate from a resting pose — the exact thing every other page
    // here is careful never to do.
    const still = thrumFrom(RESTING, 0.5, withControls({ freeRun: true }))

    expect(still.level).toBeGreaterThan(SILENCE_BELOW)
    expect(still.strike).toBeGreaterThan(0.02)
    expect(still.carAmp).toBeGreaterThan(0)
  })

  it('takes both rates from the sliders when free-running', () => {
    const now = thrumFrom(
      RESTING,
      0.5,
      withControls({ freeRun: true, tapRate: 4, flutter: 40 }),
    )

    expect(1 / now.dur).toBeCloseTo(4, 6)
    expect(now.flutRate).toBeCloseTo(40, 6)
    expect(regimeOf(now.flutRate)).toBe('rough')
  })

  it('keeps every free-run rate inside the specs the defs declare', () => {
    for (const tapRate of [RANGES.tapRate.min, 3, RANGES.tapRate.max]) {
      for (const flutter of [RANGES.flutter.min, 40, RANGES.flutter.max]) {
        const now = thrumFrom(RESTING, 0.5, withControls({ freeRun: true, tapRate, flutter }))
        // ssp_thrum_clock's dur spec.
        expect(now.dur).toBeGreaterThanOrEqual(0.12)
        expect(now.dur).toBeLessThanOrEqual(1.4)
        // ssp_thrum_bed's flutRate spec.
        expect(now.flutRate).toBeGreaterThanOrEqual(4)
        expect(now.flutRate).toBeLessThanOrEqual(90)
      }
    }
  })

  it('mutes the taps by stopping the clock, not by silencing the voice', () => {
    // A muted layer must cost no nodes. Silencing the voice would still spawn
    // one per beat, which is the thing the clock's second gate exists to avoid.
    const muted = thrumFrom(at({ shake: 1 }), 0.5, withControls({ muteTaps: true }))
    expect(muted.strike).toBe(0)
    expect(muted.strike).toBeLessThan(0.02)
  })

  it('mutes each of the other two layers independently', () => {
    const loud = at({ turn: 0.6, pitch: 1 })

    expect(thrumFrom(loud, 0.5, withControls({ muteFlutter: true })).flutAmp).toBe(0)
    expect(thrumFrom(loud, 0.5, withControls({ muteFlutter: true })).carAmp).toBeGreaterThan(0)

    expect(thrumFrom(loud, 0.5, withControls({ muteCarrier: true })).carAmp).toBe(0)
    expect(thrumFrom(loud, 0.5, withControls({ muteCarrier: true })).flutAmp).toBeGreaterThan(0)
  })

  it('can silence the whole page from the drive control', () => {
    const dead = thrumFrom(at({ shake: 1, turn: 1, pitch: 1 }), 0.5, withControls({ drive: 0 }))
    expect(dead.tapAmp).toBe(0)
    expect(dead.bedAmp).toBe(0)
  })

  it('parks the carrier where the slider puts it, with roll as an offset', () => {
    const centred = thrumFrom(at({ roll: 0 }), 0.5, withControls({ carrier: 200 }))
    expect(centred.carFreq).toBeCloseTo(200, 6)

    // Roll moves it but cannot carry it out of the def's declared range.
    for (const roll of [-1, -0.5, 0.5, 1]) {
      for (const carrier of [RANGES.carrier.min, 250, RANGES.carrier.max]) {
        const now = thrumFrom(at({ roll }), 0.5, withControls({ carrier }))
        expect(now.carFreq).toBeGreaterThanOrEqual(RANGES.carrier.min)
        expect(now.carFreq).toBeLessThanOrEqual(RANGES.carrier.max)
      }
    }
  })

  it('opens in gesture mode with nothing muted', () => {
    // The controls are opt-in: landing on the page gives you the three gestures,
    // not a panel you have to understand first. Free run and the mutes are
    // things you reach for, which is why none of them is the default.
    expect(DEFAULT_CONTROLS.freeRun).toBe(false)
    expect(DEFAULT_CONTROLS.muteTaps).toBe(false)
    expect(DEFAULT_CONTROLS.muteFlutter).toBe(false)
    expect(DEFAULT_CONTROLS.muteCarrier).toBe(false)

    // And omitting the argument has to mean the same thing as passing the
    // defaults, or the page and the tests are exercising different mappings.
    const implicit = thrumFrom(at({ shake: 0.6, turn: 0.4, pitch: 0.5 }))
    const explicit = thrumFrom(at({ shake: 0.6, turn: 0.4, pitch: 0.5 }), 0.5, DEFAULT_CONTROLS)
    expect(implicit).toEqual(explicit)
  })

  it('starts louder than the version that was reported unfeelable', () => {
    // The first thing to try when nothing arrives is more level, so the page
    // should not need that discovered before it does anything. 0.6 was the old
    // ceiling on tapAmp; the default now clears it.
    expect(thrumFrom(at({ shake: 1 })).tapAmp).toBeGreaterThan(0.6)
  })
})
