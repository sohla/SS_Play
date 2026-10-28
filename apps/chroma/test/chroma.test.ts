import { describe, expect, it } from 'vitest'
import type { Motion } from '@ss/motion'
import { FIRST, hueStep, nextColour } from '../src/colour.ts'
import { chromaFrom } from '../src/mapping.ts'
import {
  BAR_MS,
  LEVELS,
  PHRASE_TICKS,
  TICKS_PER_BAR,
  TICK_MS,
  eventsFor,
  hitAt,
  parseBar,
  type Kit,
} from '../src/phrase.ts'

const KIT: Kit = { kick: 1, snare: 2, ghost: 3, hats: [4, 5] }

/** A real-magnitude tick on a phrase boundary, as a phone will see. */
const FROM = Math.floor(1_760_000_000_000 / TICK_MS / PHRASE_TICKS) * PHRASE_TICKS

/** Onsets of one level over a phrase, as offsets, with each one's length. */
function onsets(level: number) {
  const found: { at: number; ticks: number; accent: boolean }[] = []
  for (let at = 0; at < PHRASE_TICKS; at++) {
    const hit = hitAt(FROM + at, level)
    if (hit) found.push({ at, ticks: hit.ticks, accent: hit.accent })
  }
  return found
}

describe('the grid', () => {
  it('puts the bar on whole seconds, as /sync/ does', () => {
    expect(BAR_MS % 1000).toBe(0)
    expect(TICK_MS * TICKS_PER_BAR).toBe(BAR_MS)
  })

  it('reads every bar of every level as exactly one bar', () => {
    for (const { bars } of LEVELS) for (const bar of bars) expect(() => parseBar(bar)).not.toThrow()
  })

  it('refuses a bar that does not add up', () => {
    expect(() => parseBar('K12 S12 h12')).toThrow(/36 ticks/)
  })
})

describe('the phrase', () => {
  it('starts every level on an accented kick', () => {
    for (let level = 0; level < LEVELS.length; level++) {
      expect(hitAt(FROM, level)).toMatchObject({ voice: 'kick', accent: true })
    }
  })

  it('has dotted rhythms at every level', () => {
    // A dotted eighth is 9 ticks; a dotted quarter 18.
    for (let level = 0; level < LEVELS.length; level++) {
      expect(onsets(level).some(({ ticks }) => ticks === 9 || ticks === 18)).toBe(true)
    }
  })

  it('has triplets above the first level', () => {
    // Eighth triplets are 4 ticks, quarter triplets 8, sixteenth triplets 2.
    expect(onsets(0).some(({ ticks }) => [2, 4, 8].includes(ticks))).toBe(false)
    expect(onsets(1).some(({ ticks }) => ticks === 4 || ticks === 8)).toBe(true)
    expect(onsets(2).some(({ ticks }) => ticks === 2)).toBe(true)
  })

  it('grows denser level by level', () => {
    const counts = LEVELS.map((_, level) => onsets(level).length)
    expect(counts).toEqual([...counts].sort((a, b) => a - b))
    expect(new Set(counts).size).toBe(counts.length)
  })

  it('is the same at the same absolute tick, wherever it is read from', () => {
    expect(hitAt(FROM + 7 * PHRASE_TICKS + 12, 1)).toEqual(hitAt(FROM + 12, 1))
  })

  it('plays nothing when the phone is silent', () => {
    expect(eventsFor(hitAt(FROM, 2), FROM, 0, KIT)).toEqual([])
  })

  it('holds no hit past the next one', () => {
    for (let level = 0; level < LEVELS.length; level++) {
      for (const { at } of onsets(level)) {
        const [event] = eventsFor(hitAt(FROM + at, level), FROM + at, 0.5, KIT)
        expect(event!.def).toBe('ssp_kit')
        expect(event!.sustain! * 1000).toBeLessThan(hitAt(FROM + at, level)!.ticks * TICK_MS)
      }
    }
  })
})

describe('the colour', () => {
  it('moves at least 100° round the wheel on every change', () => {
    let colour = FIRST
    for (let n = 0; n < 500; n++) {
      const next = nextColour(colour, FROM + n * 9)
      expect(Math.abs(hueStep(colour.hue, next.hue))).toBeGreaterThanOrEqual(100 - 1e-9)
      expect(next.saturation).toBeGreaterThanOrEqual(85)
      colour = next
    }
  })
})

describe('the mapping', () => {
  const at = (shake: number) => chromaFrom({ shake } as Motion)

  it('is silent at rest and on the lowest level', () => {
    expect(at(0)).toEqual({ level: 0, amp: 0 })
  })

  it('climbs through every level as movement rises', () => {
    const levels = [0.05, 0.3, 0.6, 1].map((shake) => at(shake).level)
    expect(levels).toEqual([...levels].sort((a, b) => a - b))
    expect(levels.at(-1)).toBe(LEVELS.length - 1)
  })
})
