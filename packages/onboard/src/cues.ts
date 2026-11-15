/**
 * The score's vocabulary: what a script is made of, and how it is read for one
 * phone and one person. Plain data, no React and no audio, so the Vite configs
 * can read the score to find which SynthDefs to ship.
 */

import type { PartKind } from './words.ts'

export type Platform = 'ios' | 'android' | 'other'

/**
 * Words, the same on every phone or different per platform. `other` is the
 * fallback, and an empty string leaves the line out on that phone. `{group}`
 * becomes the person's group name.
 */
export type Words = string | ({ other: string } & Partial<Record<'ios' | 'android', string>>)

export type Cue =
  /** Speak a line, and show it as `as`. `rate` and `pitch` override the score's voice for it. */
  | { say: Words; as: PartKind; rate?: number; pitch?: number }
  /** Sound an instrument from the score, with `args` over its own. */
  | { play: string; args?: Record<string, number> }
  /** Wait, in beats at the score's tempo. */
  | { rest: number }

export type Script = readonly Cue[]

export const title = (words: Words): Cue => ({ say: words, as: 'heading' })
export const say = (words: Words, voice?: { rate?: number; pitch?: number }): Cue => ({ say: words, as: 'say', ...voice })
export const item = (words: Words): Cue => ({ say: words, as: 'item' })
export const quote = (words: Words): Cue => ({ say: words, as: 'quote' })
export const play = (instrument: string, args?: Record<string, number>): Cue => (args ? { play: instrument, args } : { play: instrument })
export const rest = (beats: number): Cue => ({ rest: beats })

export interface Instrument {
  def: string
  args: Record<string, number>
}

/** A script as one phone and one person will meet it: plain text, empty lines gone. */
export type Resolved =
  | { say: string; as: PartKind; rate?: number; pitch?: number }
  | { play: string; args?: Record<string, number> }
  | { rest: number }

export function resolve(script: Script, platform: Platform, group: string): Resolved[] {
  const out: Resolved[] = []
  for (const cue of script) {
    if (!('say' in cue)) {
      out.push(cue)
      continue
    }
    const words = typeof cue.say === 'string' ? cue.say : (cue.say[platform === 'other' ? 'other' : platform] ?? cue.say.other)
    if (words) out.push({ ...cue, say: words.replaceAll('{group}', group) })
  }
  return out
}

/** Every SynthDef the score's instruments use, for the page to load. */
export function synthdefsOf(instruments: Record<string, Instrument>): string[] {
  return [...new Set(Object.values(instruments).map((instrument) => instrument.def))]
}
