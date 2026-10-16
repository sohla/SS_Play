import type { GridEvent, LoadedSample } from '@ss/engine'
import type { Gesture } from './mapping.ts'
import type { Pattern } from './pattern.ts'
import { positionOf } from './song.ts'

/**
 * Ticks per sixteenth on the drums' own grid.
 *
 * Six, because six divides into both of the subdivisions breakcore lives on: a
 * 32nd is three ticks and a 32nd-triplet is two. One tick — a twenty-fourth of a
 * beat, about 19ms at this tempo — is the buzz roll, as fast as a snare can be
 * retriggered and still be heard as a snare.
 *
 * The drums run on a `GridConductor` of their own at `stepMs / 6`. Both grids
 * are anchored at the epoch, so tick `6k` *is* sixteenth `k` of the song, and the
 * drums stay locked to the tune however finely they cut.
 */
export const TICKS_PER_STEP = 6

/**
 * Seven of the twelve kit samples: the short ones, plus one ride for a crash.
 * About 3.2s of mono audio, 0.6MB decoded. The other five rides are two seconds
 * each and add nothing a breakbeat needs.
 */
export const KICK = 'kit_bdrum_yamaha.flac'
export const SNARES = ['kit_slap_1.flac', 'kit_slap_2.flac', 'kit_slap_3.flac'] as const
export const HATS = ['kit_swis_1.flac', 'kit_swis_4.flac'] as const
export const CRASH = 'kit_ride_16b.flac'
export const DRUM_LIBRARY = [KICK, ...SNARES, ...HATS, CRASH]

export interface Kit {
  kick: number
  snares: number[]
  hats: number[]
  crash: number
}

/** Buffers by role, matched by name — a reordered set must not swap a kick for a hat. */
export function kitFrom(samples: readonly LoadedSample[]): Kit | null {
  const bufnum = (name: string) => samples.find((one) => one.name === name)?.bufnum
  const kick = bufnum(KICK)
  const crash = bufnum(CRASH)
  const snares = SNARES.map(bufnum)
  const hats = HATS.map(bufnum)
  if (kick === undefined || crash === undefined) return null
  if (snares.includes(undefined) || hats.includes(undefined)) return null
  return { kick, crash, snares: snares as number[], hats: hats as number[] }
}

/**
 * A number in 0..1 from an integer, the same on every device.
 *
 * The glitches are chance, but not `Math.random()`: two phones on the same grid
 * cut the same break, and a test can replay a bar exactly. The step is split
 * into 16-bit halves first because absolute steps run past 2^33, and the integer
 * multiply below only sees 32 bits.
 */
export function chance(n: number, salt: number): number {
  const lo = n % 65536
  const hi = Math.floor(n / 65536) % 65536
  let x = Math.imul(lo ^ Math.imul(hi, 0x27d4eb2d), 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d)
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39)
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296
}

const dbamp = (db: number) => 10 ** (db * 0.05)

/** Energy below which the drums are silent and the tune plays alone. */
export const DRUMS_BELOW = 0.06

/** What carries over from one tick to the next. */
export interface Drummer {
  /** A roll in progress: until which tick, every how many ticks, from which. */
  roll: { from: number; until: number; every: number } | null
  /** A beat-repeat in progress, replaying `source` until `until`. */
  stutter: { until: number; length: number; source: Map<number, GridEvent[]> } | null
  /** Everything played in the last beat, by tick offset — what a stutter replays. */
  heard: Map<number, GridEvent[]>
  /** For the readout. */
  doing: string
}

export const freshDrummer = (): Drummer => ({ roll: null, stutter: null, heard: new Map(), doing: '' })

/**
 * The waltz break, before anything is cut up.
 *
 * Venetian Snares wrote a whole album of breakcore in 3/4 over string waltzes,
 * which is the licence for this: Happy Birthday is a waltz, and the break is in
 * the song's own bar. Kick on one, a kick pushed off the beat, snare on the
 * second beat and on the "and" of the third — so it leans against the
 * "oom-pah-pah" rather than doubling it.
 *
 * Twelve sixteenths, 0 is the downbeat.
 */
const KICKS = new Set([0, 3, 7])
const BACKBEATS = new Set([4, 10])
const GHOSTS = new Set([6, 9, 11])

/**
 * The drums for one tick of their grid.
 *
 * Energy — smoothed shake, the same signal that brings the descant in — is the
 * single dial, and it does not just make the break louder. It changes what the
 * break *is*, in the order breakcore escalates:
 *
 * | energy | adds |
 * |---|---|
 * | any    | the waltz break: kick, backbeat, eighth hats |
 * | > 0.3  | ghost snares, sixteenth hats, the first snare rolls |
 * | > 0.45 | resonant zaps in place of hats — the high-pass ringing at a pitch |
 * | > 0.6  | the kick cuts in sevens across the bar line, against the waltz |
 * | > 0.7  | beat-repeats: a beat replays the one before it, reversed or bent |
 *
 * Rolls get both commoner and finer as energy rises: 32nds, then
 * 32nd-triplets, then the one-tick buzz, with the snare's playback rate climbing
 * through the roll — the pitched-up roll into a downbeat that is the most
 * recognisable gesture in the genre.
 */
export function drumsAt(
  pattern: Pattern,
  tick: number,
  gesture: Gesture,
  kit: Kit,
  state: Drummer,
): GridEvent[] {
  const energy = gesture.energy
  if (energy < DRUMS_BELOW) {
    state.roll = null
    state.stutter = null
    state.heard.clear()
    state.doing = 'resting'
    return []
  }

  const sub = ((tick % TICKS_PER_STEP) + TICKS_PER_STEP) % TICKS_PER_STEP
  const step = Math.floor(tick / TICKS_PER_STEP)
  const position = positionOf(pattern, step)
  const inBar = position % pattern.stepsPerBar
  const beatTicks = pattern.stepsPerBeat * TICKS_PER_STEP
  const inBeat = ((tick % beatTicks) + beatTicks) % beatTicks
  const level = dbamp(-16 + energy * 10)
  const sixteenthS = pattern.stepMs / 1000

  // A beat-repeat replays the previous beat's hits at the same offsets, so it
  // stays on the grid however cut up the source was.
  if (state.stutter && tick < state.stutter.until) {
    return state.stutter.source.get(inBeat % state.stutter.length) ?? []
  }
  state.stutter = null

  if (inBeat === 0) {
    if (energy > 0.7 && state.heard.size > 0 && chance(step, 1) < (energy - 0.7) * 1.6) {
      // Half a beat or a whole one, replayed for one beat: the stutter.
      const length = chance(step, 2) < 0.5 ? beatTicks / 2 : beatTicks
      const bend = chance(step, 3) < 0.5 ? -1 : 0.5
      const source = new Map<number, GridEvent[]>()
      for (const [offset, events] of state.heard) {
        if (offset >= length) continue
        source.set(
          offset,
          events.map((event) => ({
            ...event,
            controls: {
              ...event.controls,
              rate: (event.controls.rate ?? 1) * bend,
              // Backwards from the start of a buffer is straight off its edge,
              // so a reversed hit starts from the end and swells into the beat.
              start: bend < 0 ? 0.99 : 0,
            },
          })),
        )
      }
      state.stutter = { until: tick + beatTicks, length, source }
      state.heard = new Map()
      state.doing = bend < 0 ? 'stutter, reversed' : 'stutter, down an octave'
      return source.get(0) ?? []
    }
    state.heard = new Map()
  }

  const events: GridEvent[] = []
  const remember = () => {
    if (events.length) state.heard.set(inBeat, [...(state.heard.get(inBeat) ?? []), ...events])
    return events
  }

  if (state.roll && tick >= state.roll.until) state.roll = null

  const rollChance = energy > 0.3 ? (energy - 0.3) * 0.5 : 0
  if (!state.roll && sub === 0 && !BACKBEATS.has(inBar) && chance(step, 6) < rollChance) {
    const every = energy > 0.85 ? 1 : energy > 0.6 ? 2 : 3
    // One to three sixteenths, and longer as the bar runs out — a roll is
    // likeliest leading into a downbeat, where it has somewhere to land.
    const span = 1 + Math.floor(chance(step, 7) * (inBar > 8 ? 3 : 2))
    state.roll = { from: tick, until: tick + span * TICKS_PER_STEP, every }
    state.doing = every === 1 ? 'buzz roll' : every === 2 ? 'triplet roll' : 'roll'
  }

  // A roll owns the snare until it ends, at whatever rate it was started.
  if (state.roll) {
    if ((tick - state.roll.from) % state.roll.every === 0) {
      const through = (tick - state.roll.from) / (state.roll.until - state.roll.from)
      events.push(
        hit(kit.snares[Math.floor(chance(tick, 4) * kit.snares.length)] as number, {
          amp: level * (0.35 + 0.5 * through),
          rate: 1 + through * (0.5 + energy),
          pan: (chance(tick, 5) - 0.5) * 0.6,
          cutoff: 220,
          seconds: (state.roll.every / TICKS_PER_STEP) * sixteenthS,
        }),
      )
    }
    return remember()
  }

  // Everything below starts on a sixteenth; the ticks between belong to rolls
  // and stutters.
  if (sub !== 0) return remember()
  state.doing = energy > 0.6 ? 'cutting in sevens' : energy > 0.3 ? 'breaking' : 'waltz'

  const sevens = energy > 0.6
  const kicked = sevens ? [0, 3].includes(((step % 7) + 7) % 7) : KICKS.has(inBar)
  if (kicked || inBar === 0) {
    events.push(hit(kit.kick, { amp: level * 1.1, rate: 1, pan: 0, cutoff: 40, seconds: 2 * sixteenthS }))
  }

  if (BACKBEATS.has(inBar) || (sevens && ((step % 7) + 7) % 7 === 5)) {
    const which = Math.floor(chance(step, 8) * kit.snares.length)
    events.push(
      hit(kit.snares[which] as number, { amp: level * 0.9, rate: 1, pan: 0.05, cutoff: 220, seconds: 2 * sixteenthS }),
    )
  } else if (energy > 0.3 && GHOSTS.has(inBar)) {
    events.push(
      hit(kit.snares[2] as number, { amp: level * 0.3, rate: 1.1, pan: -0.15, cutoff: 220, seconds: 1 * sixteenthS }),
    )
  }

  const hatEvery = energy > 0.3 ? 1 : 2
  if (position % hatEvery === 0) {
    const zap = energy > 0.45 && chance(step, 9) < (energy - 0.45) * 0.6
    const hat = kit.hats[position % 2 === 0 ? 0 : 1] as number
    events.push(
      zap
        ? hit(hat, {
            amp: level * 0.5,
            rate: 1.5 + chance(step, 10) * 2.5,
            pan: (chance(step, 11) - 0.5) * 1.4,
            // The kit's high-pass is resonant — rq 0.01 — so pushed up into the
            // kilohertz it rings at the cutoff instead of filtering. That ring
            // is the zap.
            cutoff: 1200 + chance(step, 12) * 4800,
            seconds: 1 * sixteenthS,
          })
        : hit(hat, {
            amp: level * (inBar % 2 === 0 ? 0.45 : 0.28),
            rate: 1,
            pan: 0.35,
            cutoff: 220,
            seconds: 1 * sixteenthS,
          }),
    )
  }

  if (position === 0 && energy > 0.5) {
    events.push(hit(kit.crash, { amp: level * 0.5, rate: 1, pan: -0.3, cutoff: 220, seconds: 6 * sixteenthS }))
  }

  return remember()
}

/**
 * One hit on `ssp_kit`.
 *
 * Its envelope is an adsr whose *sustain is a level*, so the hold time goes on
 * the event's `sustain` — a gate — and the 0.8 stays in the controls. A hit is
 * held for 85% of the space it was given and never longer, which is what lets a
 * roll at one tick stay a roll instead of a smear.
 */
function hit(
  bufnum: number,
  {
    amp,
    rate,
    pan,
    cutoff,
    seconds,
  }: { amp: number; rate: number; pan: number; cutoff: number; seconds: number },
): GridEvent {
  return {
    def: 'ssp_kit',
    sustain: Math.max(0.01, seconds * 0.85),
    controls: { bufnum, amp, rate, pan, cutoff, release: 0.02, sustain: 0.8 },
  }
}
