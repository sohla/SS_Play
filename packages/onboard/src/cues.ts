/**
 * The script's vocabulary: a line, and how it is read for one phone and one
 * person. Plain data, no React and no audio, so the Vite configs can read the
 * script to find which SynthDefs to ship.
 */

import type { PartKind } from './words.ts'

export type Platform = 'ios' | 'android' | 'other'

/**
 * Words, the same on every phone or different per platform. `other` is the
 * fallback, and an empty string leaves the line out on that phone. `{group}`
 * becomes the person's group name.
 */
export type Words = string | ({ other: string } & Partial<Record<'ios' | 'android', string>>)

/** What follows a line once it has been said. */
export interface After {
  /** An instrument from the script's `instruments`, or `null` for none. Default `chime`. */
  play?: string | null
  /** Over the instrument's own args, for this line only: `{ note: 79 }`. */
  args?: Record<string, number>
  /** Seconds before the next line. Default: the script's `pause`. */
  pause?: number
}

export interface Line extends After {
  text: Words
  as: PartKind
}

export type Script = readonly Line[]

export const title = (text: Words, after: After = {}): Line => ({ text, as: 'heading', ...after })
export const say = (text: Words, after: After = {}): Line => ({ text, as: 'say', ...after })
export const item = (text: Words, after: After = {}): Line => ({ text, as: 'item', ...after })
export const quote = (text: Words, after: After = {}): Line => ({ text, as: 'quote', ...after })

export interface Instrument {
  def: string
  args: Record<string, number>
}

/** A line as one phone and one person will meet it. */
export interface Resolved {
  text: string
  as: PartKind
  play: string | null
  args?: Record<string, number>
  /** Seconds. */
  pause: number
}

export function resolve(script: Script, platform: Platform, group: string, pause: number): Resolved[] {
  const out: Resolved[] = []
  for (const line of script) {
    const words =
      typeof line.text === 'string' ? line.text : (line.text[platform === 'other' ? 'other' : platform] ?? line.text.other)
    if (!words) continue
    out.push({
      text: words.replaceAll('{group}', group),
      as: line.as,
      play: line.play === undefined ? 'chime' : line.play,
      ...(line.args ? { args: line.args } : {}),
      pause: line.pause ?? pause,
    })
  }
  return out
}

/** Every SynthDef the script's instruments use, for the page to load. */
export function synthdefsOf(instruments: Record<string, Instrument>): string[] {
  return [...new Set(Object.values(instruments).map((instrument) => instrument.def))]
}
