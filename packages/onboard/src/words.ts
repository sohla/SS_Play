/**
 * A screen's text as the narrator sees it: one string, cut into words that
 * remember which part of the screen they belong to.
 *
 * The narrator speaks a whole screen as one utterance — heading, sentences and
 * list items joined by spaces — and reports where it is as a character offset
 * into that string. The screen draws the same words in their own places. This
 * is the map between the two.
 */

export type PartKind = 'heading' | 'say' | 'item' | 'quote'

export interface Part {
  kind: PartKind
  text: string
}

export interface Word {
  text: string
  /** Offset into the joined text. */
  start: number
  end: number
  /** Which part it is drawn in. */
  part: number
}

/** The joined text the narrator speaks, and every word in it. */
export function wordsOf(parts: readonly Part[]): { spoken: string; words: Word[] } {
  const words: Word[] = []
  let spoken = ''
  parts.forEach((part, index) => {
    if (index > 0) spoken += ' '
    const offset = spoken.length
    for (const match of part.text.matchAll(/\S+/g)) {
      words.push({
        text: match[0],
        start: offset + match.index!,
        end: offset + match.index! + match[0].length,
        part: index,
      })
    }
    spoken += part.text
  })
  return { spoken, words }
}

/**
 * The word at a character offset, as a voice's boundary event gives it: the
 * last word starting at or before it. Voices differ on whether the offset
 * lands on the word or the space before, and this takes either.
 */
export function wordAt(words: readonly Word[], charIndex: number): number {
  let found = -1
  for (let n = 0; n < words.length; n++) {
    if (words[n]!.start <= charIndex + 1) found = n
    else break
  }
  return Math.max(0, found)
}

/**
 * When each word should light, in ms from the start, for a voice that sends no
 * word events — Chrome's online voices, some Android ones. Longer words take
 * longer, punctuation adds a breath. At the default rate a voice runs about
 * 13–15 characters a second; this errs a little slow, because a highlight that
 * runs ahead of the voice reads as broken and one that lags reads as listening.
 */
export function estimatedTimes(words: readonly Word[]): number[] {
  const times: number[] = []
  let at = 0
  for (const word of words) {
    times.push(at)
    at += 120 + 62 * word.text.replace(/[^\p{L}\p{N}]/gu, '').length
    if (/[.!?:]$/.test(word.text)) at += 320
    else if (/[,;]$/.test(word.text)) at += 160
  }
  return times
}
