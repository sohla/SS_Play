/**
 * The onboarding's script: what is said, what sounds after each line, how long
 * it rests, and the order of the steps. Edit this file to change the flow; the
 * code performs it.
 *
 * Each screen is a list of lines, spoken one after another. After each line:
 * its instrument plays, then a pause, then the next line.
 *
 *   say('Headphones off.')                          then the chime, then `pause` seconds
 *   say('Headphones off.', { args: { note: 79 } })  the chime on another note
 *   say('Headphones off.', { play: 'low', pause: 3 })
 *   say('Headphones off.', { play: null })          no sound after it
 *
 * `title`, `say`, `item` and `quote` are the same, drawn differently. Words can
 * differ per phone — `{ ios: '…', android: '…', other: '…' }`, where `other` is
 * the fallback and '' leaves the line out — and `{group}` is the group's name.
 *
 * A screen's buttons wait until its last line, sound and pause are done.
 */

import { item, quote, say, title, type Instrument, type Script } from './cues.ts'
import type { StepId } from './flow.ts'

export const voice = {
  /** Apple's British voice where the phone has it; otherwise the phone's own language. */
  name: /^Daniel\b/,
  /** 1 is the voice's normal pace; lower is slower. */
  rate: 0.85,
  /** Played on every word the voice reports, as on `/speak/`: an instrument name, or null. */
  word: null as string | null,
}

/** Seconds after a line's sound, unless the line says otherwise. */
export const pause = 1.6

/**
 * Sounds the lines can `play`. `def` is a SynthDef: a vendored `sonic-pi-*`
 * one, or an `ssp_*` one from the sidecar. It must free itself after a note.
 */
export const instruments: Record<string, Instrument> = {
  /** After each line. */
  chime: { def: 'sonic-pi-pretty_bell', args: { note: 76, amp: 0.6, release: 1.2 } },
  /** As `/speak/` ends its lines. Not used yet. */
  low: { def: 'sonic-pi-dull_bell', args: { note: 55, amp: 0.3, release: 2 } },
  /** As `/speak/` marks its words: try it as `voice.word`. */
  tinkle: { def: 'sonic-pi-pretty_bell', args: { note: 96, amp: 0.08, release: 0.4 } },
  /**
   * The check sound, repeated on the volume and tone steps. Version A measures
   * it within 450 ms of each note, and needs it 15 dB over the room: keep a
   * fast attack and enough level.
   */
  tone: { def: 'sonic-pi-pretty_bell', args: { note: 76, amp: 0.6, release: 1.2 } },
}

/** Seconds between the check sound's notes. */
export const toneEvery = 1

/**
 * The steps, in order. `start` first and `ready` last. Version A must open the
 * microphone (`mic`) before `quiet`, and measure the room (`quiet`) before its
 * `tone`; `voice` needs the microphone too. B has no microphone: only the
 * asked checks, `toneAsk` and `voiceAsk`. When A's microphone is refused, the
 * person carries on with B's steps from the first one they have not yet done.
 */
export const order: Record<'A' | 'B', readonly StepId[]> = {
  A: ['start', 'speaker', 'volume', 'mic', 'quiet', 'tone', 'voice', 'motion', 'ready'],
  B: ['start', 'speaker', 'volume', 'toneAsk', 'voiceAsk', 'motion', 'ready'],
}

export const scripts = {
  // Shown, not spoken: a phone cannot speak before the first tap.
  start: [title('Hello, {group}.'), say('Let’s get your phone ready.')],

  speaker: [
    title('Sound on the speaker'),
    item('Headphones off.'),
    item('Bluetooth off.'),
    item({ android: 'Media volume on.', other: 'Silent mode off.' }),
  ],

  // The check sound starts when this ends.
  volume: [
    title('Volume up full'),
    say('Press volume up until it stops.'),
    say({ android: 'The chime comes from the speaker.', other: 'The chime comes from the bottom, not the top.' }),
  ],

  mic: [title('Allow the microphone'), say('It listens for the chime.'), say('Nothing is recorded.')],
  micRefused: [say('No problem.'), say('Continue without it, or allow it in site settings.')],

  // The room is measured when this ends.
  quiet: [title('Quiet, please.', { pause: 1.2 })],

  tone: [title('Tone check'), say('Volume up until the bar passes the line.')],
  toneAsk: [title('Tone check'), say('Press Play.'), say('Can you hear the chime?')],

  // Version A: this, then `voiceLine`, which the microphone listens to.
  voice: [title('Voice check'), say('Listen.')],
  // The narrator under test. No sound after it: the microphone would take it for the voice.
  voiceLine: [quote('Hello. This is the narrator.', { play: null, pause: 0 })],
  // Version B: Play says `voiceLine`.
  voiceAsk: [title('Voice check'), say('Press Play.'), say('Can you hear a voice?')],

  motion: [title('Shake test'), say('Tap Allow motion.')],
  motionWatching: [title('Shake test'), say('Shake your phone gently.')],

  ready: [title('You’re ready.'), say('Keep this screen open.')],

  // Read out when a check fails.
  fixes: {
    sound: [
      item({ android: 'Media volume up.', other: 'Silent switch off: no orange.' }),
      item('Bluetooth off. Headphones out.'),
      item('Volume up, loud.'),
      item({ android: '', other: 'Sound from the top, like a call? Close this tab and reopen the link.' }),
    ],
    soundMeasured: [
      item({ android: 'Media volume up.', other: 'Silent switch off: no orange.' }),
      item('Bluetooth off. Headphones out.'),
      item('Volume up until the bar passes the line.'),
      item({ android: '', other: 'Sound from the top, like a call? Reopen the link, and skip the microphone.' }),
    ],
    voice: [
      item('Volume up, then Play again.'),
      item({ android: '', other: 'Sound from the top, like a call? Close this tab and reopen the link.' }),
    ],
    voiceMeasured: [
      item('Volume up, then Play again.'),
      item({ android: '', other: 'Sound from the top, like a call? Reopen the link, and skip the microphone.' }),
    ],
    motion: [item('Tap Allow motion again.'), item('Or check site settings.')],
  },
} satisfies Record<string, Script | Record<string, Script>>
