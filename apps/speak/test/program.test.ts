import { describe, expect, it } from 'vitest'
import { phrasesFor, PHRASES } from '../src/phrases.ts'
import { PROGRAM, SPANS, dueBetween, secondOf } from '../src/program.ts'

/** A real-magnitude instant on the top of a minute. */
const MINUTE = Math.floor(1_760_000_000_000 / 60_000) * 60_000

describe('the program', () => {
  it('counts one to ten across the first ten seconds', () => {
    const counts = PROGRAM.filter((cue) => cue.kind === 'count')
    expect(counts.map((cue) => cue.at)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(counts.map((cue) => (cue.kind === 'count' ? cue.n : 0))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('fires each cue once, in the tick that crosses it', () => {
    const fired: number[] = []
    for (let now = MINUTE - 100; now < MINUTE + 60_000; now += 100) {
      for (const { cue, due } of dueBetween(now - 100, now)) {
        expect(due).toBe(MINUTE + cue.at * 1000)
        fired.push(cue.at)
      }
    }
    expect(fired).toEqual(PROGRAM.map((cue) => cue.at))
  })

  it('does not read out a backlog after the tab was away', () => {
    // Away for 30s: only what fell due in the last 1.5s comes back.
    const late = dueBetween(MINUTE, MINUTE + 9_200)
    expect(late.map(({ cue }) => cue.at)).toEqual([8, 9])
  })

  it('rolls over into the next minute', () => {
    const across = dueBetween(MINUTE + 59_900, MINUTE + 60_050)
    expect(across).toHaveLength(1)
    expect(across[0]!.due).toBe(MINUTE + 60_000)
    expect(secondOf(MINUTE + 60_050)).toBe(0)
  })

  it('draws a span for every block of lines', () => {
    for (const cue of PROGRAM) {
      if (cue.kind !== 'lines') continue
      expect(SPANS.some((span) => span.label === cue.block && span.from === cue.at)).toBe(true)
    }
  })
})

describe('the phrases', () => {
  it('has every block in every language', () => {
    for (const [lang, blocks] of Object.entries(PHRASES)) {
      expect(blocks.welcome.length, lang).toBeGreaterThan(0)
      expect(blocks.instruction.length, lang).toBeGreaterThan(0)
    }
  })

  it('picks by language prefix, and falls back to English', () => {
    expect(phrasesFor('fr-CA')).toBe(PHRASES['fr'])
    expect(phrasesFor('ja-JP')).toBe(PHRASES['ja'])
    expect(phrasesFor('nl-NL')).toBe(PHRASES['en'])
  })
})
