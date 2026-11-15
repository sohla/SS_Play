import { describe, expect, it } from 'vitest'
import { wordsOf } from '../src/words.ts'

const SCREEN = [
  { kind: 'heading' as const, text: 'Quiet first' },
  { kind: 'say' as const, text: 'Stay quiet for a moment.' },
]

describe('words', () => {
  it('joins a screen into one spoken string, and keeps where each word is drawn', () => {
    const { spoken, words } = wordsOf(SCREEN)
    expect(spoken).toBe('Quiet first Stay quiet for a moment.')
    expect(words.map((w) => w.text)).toEqual(['Quiet', 'first', 'Stay', 'quiet', 'for', 'a', 'moment.'])
    expect(words.map((w) => w.part)).toEqual([0, 0, 1, 1, 1, 1, 1])
    for (const word of words) expect(spoken.slice(word.start, word.end)).toBe(word.text)
  })
})
