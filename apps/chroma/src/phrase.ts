import type { GridEvent, LoadedSample } from '@ss/engine'

/**
 * `chroma`'s rhythm: a two-bar phrase on the sync grid, in three densities.
 *
 * ## The grid
 *
 * The same epoch-anchored clock as `/sync/` — 120bpm, a two-second bar — cut
 * into 48 ticks rather than 16. Forty-eight is the smallest count that holds
 * both families exactly: a sixteenth is 3 ticks, a dotted eighth 9, an eighth
 * triplet 4, a quarter triplet 8, a sixteenth triplet 2. With sixteen to the bar
 * a triplet would have to be rounded onto the grid, which is a different rhythm.
 *
 * 2000 / 48 is not a whole number of milliseconds and does not need to be:
 * `GridConductor` takes any positive `stepMs`, and the bar still lands on whole
 * seconds, so every device agrees on the downbeat.
 */
export const TICKS_PER_BAR = 48
export const BAR_MS = 2000
export const TICK_MS = BAR_MS / TICKS_PER_BAR
export const PHRASE_BARS = 2
export const PHRASE_TICKS = TICKS_PER_BAR * PHRASE_BARS

/**
 * The phrases, written as hits and the ticks until the next one.
 *
 * `k` kick, `s` snare, `h` hat, `.` a rest; uppercase is an **accent**, which is
 * what changes the screen's colour. So `K9` is an accented kick held for a
 * dotted eighth, and `S4 h4 h4` is a beat of eighth triplets.
 *
 * Indexed by the absolute tick, so the phrase is a pure function of wall-clock
 * time: two devices at the same density play the same bar, and moving between
 * densities changes what is played *at this position* without restarting the
 * phrase.
 */
export const LEVELS = [
  {
    name: 'dotted',
    bars: [
      // Dotted-quarter kick, snare on three: the half-time floor.
      'K18 h6 S12 h6 h6',
      // Two dotted eighths into the snare, and a pickup kick.
      'K9 k9 h6 S12 h3 k9',
    ],
  },
  {
    name: 'triplets',
    bars: [
      // Dotted eighth, a ghost, then a beat of eighth triplets off the snare.
      'K9 h3 s6 h6 S4 h4 h4 k6 h6',
      // Quarter triplets across beats two and three, against the straight kick.
      'K6 h3 h3 S8 k8 h8 S9 h3',
    ],
  },
  {
    name: 'dense',
    bars: [
      // Sixteenths, a dotted-eighth snare, sixteenth-triplet hats, ghost triplets.
      'K3 h3 s3 h3 S9 h3 h2 h2 h2 K6 s2 s2 s2 S6',
      'K9 k3 S4 h4 h4 K6 h3 h3 s2 s2 s2 S6',
    ],
  },
] as const

export type Voice = 'kick' | 'snare' | 'hat'

export interface Hit {
  voice: Voice
  accent: boolean
  /** Ticks until the next hit — how long this one may ring. */
  ticks: number
}

const VOICES: Record<string, Voice> = { k: 'kick', s: 'snare', h: 'hat' }

/** One bar's notation as hits by tick offset. Throws on a bar that does not add up. */
export function parseBar(bar: string): Map<number, Hit> {
  const hits = new Map<number, Hit>()
  let at = 0
  for (const token of bar.trim().split(/\s+/)) {
    const match = /^([kshKSH.])(\d+)$/.exec(token)
    if (!match) throw new Error(`Unreadable token "${token}" in "${bar}"`)
    const [, letter, length] = match as unknown as [string, string, string]
    const ticks = Number(length)
    if (letter !== '.') {
      hits.set(at, {
        voice: VOICES[letter.toLowerCase()]!,
        accent: letter !== letter.toLowerCase(),
        ticks,
      })
    }
    at += ticks
  }
  if (at !== TICKS_PER_BAR) throw new Error(`"${bar}" is ${at} ticks, not ${TICKS_PER_BAR}`)
  return hits
}

/** Every level's phrase, by tick offset into the phrase. Parsed once, at load. */
const PARSED: readonly Map<number, Hit>[] = LEVELS.map(({ bars }) => {
  const phrase = new Map<number, Hit>()
  bars.forEach((bar, index) => {
    for (const [at, hit] of parseBar(bar)) phrase.set(index * TICKS_PER_BAR + at, hit)
  })
  return phrase
})

/** Position within the phrase, 0..PHRASE_TICKS-1, for any absolute tick. */
export function positionOf(tick: number): number {
  return ((tick % PHRASE_TICKS) + PHRASE_TICKS) % PHRASE_TICKS
}

/** What the phrase plays at this tick and density, if anything. */
export function hitAt(tick: number, level: number): Hit | null {
  return PARSED[level]?.get(positionOf(tick)) ?? null
}

/**
 * Seven of the kit's samples — short ones only, about 2.6s of mono audio.
 *
 * Two snares so an accent and a ghost are different drums rather than one drum
 * at two levels, and two hats so a run of them alternates instead of machine-gunning.
 */
export const KICK = 'kit_bdrum_yamaha.flac'
export const SNARE = 'kit_slap_1.flac'
export const GHOST = 'kit_slap_2.flac'
export const HATS = ['kit_swis_1.flac', 'kit_swis_4.flac'] as const
export const LIBRARY = [KICK, SNARE, GHOST, ...HATS]

export interface Kit {
  kick: number
  snare: number
  ghost: number
  hats: readonly [number, number]
}

/** Buffers by role, matched by name — a reordered set must not swap a kick for a hat. */
export function kitFrom(samples: readonly LoadedSample[]): Kit | null {
  const bufnum = (name: string) => samples.find((one) => one.name === name)?.bufnum
  const [kick, snare, ghost, hat0, hat1] = LIBRARY.map(bufnum)
  if ([kick, snare, ghost, hat0, hat1].includes(undefined)) return null
  return { kick: kick!, snare: snare!, ghost: ghost!, hats: [hat0!, hat1!] }
}

/** Each voice's level against the others, before the phone scales them all. */
const WEIGHT = { kick: 1, snare: 0.85, ghost: 0.35, hat: 0.4 } as const
/** An unaccented kick or hat sits back this far. */
const UNACCENTED = 0.75

/**
 * The events for one tick, scaled by the phone's `amp`.
 *
 * Hats pan by position in the bar rather than at random, so the phrase has the
 * same shape on every device and a test can replay it.
 */
export function eventsFor(hit: Hit | null, tick: number, amp: number, kit: Kit): GridEvent[] {
  if (!hit || amp <= 0) return []

  const seconds = (hit.ticks * TICK_MS) / 1000
  const position = positionOf(tick)

  if (hit.voice === 'kick') {
    return [one(kit.kick, amp * WEIGHT.kick * (hit.accent ? 1 : UNACCENTED), 0, seconds)]
  }
  if (hit.voice === 'snare') {
    return hit.accent
      ? [one(kit.snare, amp * WEIGHT.snare, 0, seconds)]
      : [one(kit.ghost, amp * WEIGHT.ghost, -0.15, seconds)]
  }
  const side = position % 2 === 0 ? 0.3 : -0.3
  return [
    one(kit.hats[position % 2]!, amp * WEIGHT.hat * (hit.accent ? 1 : UNACCENTED), side, seconds),
  ]
}

/**
 * One hit on `ssp_kit`, as `/birthday/` plays it: the adsr's sustain is a level,
 * so the hold goes on the event's gate and 85% of the space it was given keeps a
 * run of sixteenth triplets from smearing into one another.
 */
function one(bufnum: number, amp: number, pan: number, seconds: number): GridEvent {
  return {
    def: 'ssp_kit',
    sustain: Math.max(0.01, seconds * 0.85),
    controls: { bufnum, amp, rate: 1, pan, cutoff: 20, release: 0.02, sustain: 0.8 },
  }
}
