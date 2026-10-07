import type { LoadedSample, ScheduledEvent } from '@ss/engine'
import { DIVS, RATES, BEAT_S, type Kit } from './mapping.ts'

/** Names the kick lane is found by, in the original's order. */
const KICK_NAMES = ['drum', 'kick', 'bd']

/**
 * The kit, sorted short to long, with the kick located.
 *
 * Both are the original's doing and both matter. The sort makes the lane index
 * mean something — a small palette is the short dry sounds and a large one
 * reaches the rides — and the kick is found by name rather than by position so
 * the kit can be reordered or replaced without the downbeat moving.
 */
export interface Kit4 {
  buffers: number[]
  kickIdx: number
  names: string[]
}

export function arrangeKit(samples: readonly LoadedSample[]): Kit4 {
  const sorted = [...samples].sort((a, b) => a.numFrames - b.numFrames)
  const kickIdx = sorted.findIndex((sample) => {
    const name = sample.name.toLowerCase()
    return KICK_NAMES.some((candidate) => name.includes(candidate))
  })

  return {
    buffers: sorted.map((sample) => sample.bufnum),
    // `?? 0` in the original — a kit with no recognisable kick still plays, with
    // the shortest sample on the downbeat.
    kickIdx: kickIdx === -1 ? 0 : kickIdx,
    names: sorted.map((sample) => sample.name),
  }
}

/**
 * multiBeat4's Pbind, as a generator.
 *
 * The thing that cannot be a Demand graph is `Pswitch(divs, Pkey(\divIdx))`:
 * both `\div` and `\step` switch on the same live index and have to stay in
 * lockstep, and the index changes while the pattern runs. Two independent Demand
 * streams reading the same bus would drift apart on any bar where the hand moved
 * mid-bar. Here it is one counter and a lookup.
 *
 * A bar is `div` steps of `beat / div`, so every subdivision takes the same half
 * second and only its resolution changes. The index is read at the *start* of a
 * bar, which is what makes a subdivision change land on the beat rather than
 * halfway through one.
 */
export function kitPattern(kit: Kit4, read: () => Kit): () => ScheduledEvent | null {
  let step = 0
  let div = DIVS[0] as number
  let palette = 1
  let energy = 0
  let roll = 1
  let cutoff = 50

  return () => {
    if (step === 0) {
      // Read once per bar, not per step: Pswitch embeds the whole sub-pattern
      // before consulting the index again.
      const now = read()
      div = DIVS[now.divIdx] ?? (DIVS[0] as number)
      palette = now.palette
      energy = now.energy
      roll = now.roll
      cutoff = now.cutoff
    }

    const dur = BEAT_S / div
    const downbeat = step === 0

    // `(e[\pal] ? 1).rand` — sclang's rand is exclusive, so a palette of 1 only
    // ever reaches lane 0.
    const pick = downbeat
      ? kit.kickIdx
      : Math.min(Math.floor(Math.random() * palette), kit.buffers.length - 1)

    const rate = (RATES[Math.floor(Math.random() * RATES.length)] as number) * roll

    const event: ScheduledEvent = {
      def: 'ssp_kit',
      dur,
      // `\legato, 0.9`: the gate is held for most of the step, then released.
      //
      // Not optional. ssp_kit's envelope is an adsr, and an adsr frees its node
      // when the gate *falls* — so a voice that never gets a gate-off sounds
      // once and then holds a node for the life of the page. Measured without
      // this line: 100 voices alive at 102 events, climbing one for one.
      //
      // Two different things are called sustain within this one object, which is
      // worth reading twice. This is the gate-hold time, which the conductor
      // turns into a scheduled `/n_set gate 0`. The one in `controls` below is
      // adsr's sustain *level*. They carry the same number only because the
      // original's legato and its event-system collision happen to agree.
      sustain: dur * 0.9,
      controls: {
        bufnum: kit.buffers[Math.max(0, Math.min(pick, kit.buffers.length - 1))] as number,
        amp: energy * (downbeat ? 1.0 : 0.55),
        rate,
        // A reverse plays from the end; forwards starts at the very beginning
        // most of the time and 12% of the time a little way in, which takes the
        // transient off without changing the note.
        start: rate < 0 ? 0.98 : Math.random() < 0.88 ? 0 : 0.12,
        release: dur * 1.2,
        // The original leaves this to sclang, which computes `dur * legato` and
        // sends it to any argument named `sustain` — and ssp_kit's sustain is
        // adsr's *level*, not a time. So in the original a 0.0625s step sets the
        // sustain level to 0.056, and the kit decays to near-silence after its
        // decay segment instead of holding at 0.8.
        //
        // Reproduced rather than corrected, because it is what the kit sounds
        // like and this is a port. Delete this line to hear it the other way.
        sustain: dur * 0.9,
        cutoff,
        pan: Math.random() * 0.8 - 0.4,
      },
    }

    step = (step + 1) % div
    return event
  }
}
