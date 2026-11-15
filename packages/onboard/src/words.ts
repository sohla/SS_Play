/**
 * A screen's text as the narrator sees it: one string, cut into words that
 * remember which part of the screen they belong to.
 *
 * The narrator speaks each part as its own line and reports each word as it
 * reaches it; the screen draws the same words in their own places, numbered
 * across the screen so one can be lit.
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
