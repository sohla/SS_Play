import { describe, expect, it } from 'vitest'
import { estimatedTimes, wordAt, wordsOf } from '../src/words.ts'

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

  it('finds the word from a boundary offset, on the word or the space before it', () => {
    const { words, spoken } = wordsOf(SCREEN)
    const stay = spoken.indexOf('Stay')
    expect(words[wordAt(words, stay)]!.text).toBe('Stay')
    expect(words[wordAt(words, stay - 1)]!.text).toBe('Stay')
    expect(words[wordAt(words, 0)]!.text).toBe('Quiet')
    expect(words[wordAt(words, spoken.length - 1)]!.text).toBe('moment.')
  })

  it('estimates a pace that waits longer for long words and full stops', () => {
    const { words } = wordsOf([{ kind: 'say', text: 'a extraordinary. b' }])
    const [a, long, b] = estimatedTimes(words)
    expect(a).toBe(0)
    expect(b! - long!).toBeGreaterThan(long! - a!)
    // Roughly a speaking rate: a ten-word sentence in two to five seconds.
    const sentence = wordsOf([{ kind: 'say', text: 'Turn off Bluetooth and unplug any headphones before you start.' }]).words
    const times = estimatedTimes(sentence)
    expect(times.at(-1)).toBeGreaterThan(2000)
    expect(times.at(-1)).toBeLessThan(5000)
  })
})
