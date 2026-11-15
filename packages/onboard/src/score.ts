/**
 * The onboarding's score: what is said, what sounds, when, and in what order.
 * Edit this file to change the flow; the code performs it.
 *
 * A script is a list of cues, played in order:
 *
 *   title('…')  say('…')  item('…')  quote('…')   speak a line, and show it
 *   play('chime')  play('chime', { note: 79 })     sound an instrument below
 *   rest(1.6)                                      wait, in beats at `tempo`
 *
 * A spoken cue waits for the voice to finish before the next cue. Words can
 * differ per phone — `{ ios: '…', android: '…', other: '…' }`, where `other`
 * is the fallback and '' leaves the line out — and `{group}` is the person's
 * group name. `say('…', { rate: 0.7 })` slows one line.
 *
 * A screen's buttons, and its checks (the measured tone and voice, the shake),
 * start once its script has finished.
 */

import { item, play, quote, rest, say, title, type Instrument, type Script } from './cues.ts'
import type { StepId } from './flow.ts'

/** Beats per minute. At 60 a beat is a second. */
export const tempo = 60

export const voice = {
  /** Tried in order by name; then any English voice on the phone. */
  prefer: ['Daniel'],
  rate: 0.85,
  pitch: 1,
  volume: 1,
}

/**
 * Sounds the scripts can `play`. `def` is a SynthDef: a vendored `sonic-pi-*`
 * one, or an `ssp_*` one from the sidecar.
 */
export const instruments: Record<string, Instrument> = {
  /** Between lines. */
  chime: { def: 'sonic-pi-pretty_bell', args: { note: 76, amp: 0.6, release: 1.2 } },
  /**
   * The check sound, pulsed on the volume and tone steps. Version A measures
   * it within 450 ms of each pulse, and needs it 15 dB over the room: keep a
   * fast attack and enough level.
   */
  tone: { def: 'sonic-pi-pretty_bell', args: { note: 76, amp: 0.6, release: 1.2 } },
}

/** How often the check sound pulses, in beats. */
export const pulseEvery = 1

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

const chime = play('chime')

export const scripts = {
  // Shown, not spoken: a phone cannot speak before the first tap.
  start: [title('Hello, {group}.'), say('Let’s get your phone ready.')],

  speaker: [
    title('Sound on the speaker'), chime, rest(1.6),
    item('Headphones off.'), chime, rest(1.6),
    item('Bluetooth off.'), chime, rest(1.6),
    item({ android: 'Media volume on.', other: 'Silent mode off.' }), chime, rest(0.8),
  ],

  // The check sound starts pulsing when this ends.
  volume: [
    title('Volume up full'), chime, rest(1.6),
    say('Press volume up until it stops.'), chime, rest(1.6),
    say({ android: 'The chime comes from the speaker.', other: 'The chime comes from the bottom, not the top.' }), chime, rest(0.8),
  ],

  mic: [
    title('Allow the microphone'), chime, rest(1.6),
    say('It listens for the chime.'), chime, rest(1.6),
    say('Nothing is recorded.'), chime, rest(0.8),
  ],
  micRefused: [
    say('No problem.'), chime, rest(1.6),
    say('Continue without it, or allow it in site settings.'), chime, rest(0.8),
  ],

  // The room is measured when this ends: leave the chime time to die away.
  quiet: [title('Quiet, please.'), chime, rest(0.8)],

  tone: [
    title('Tone check'), chime, rest(1.6),
    say('Volume up until the bar passes the line.'), chime, rest(0.8),
  ],
  toneAsk: [
    title('Tone check'), chime, rest(1.6),
    say('Press Play.'), chime, rest(1.6),
    say('Can you hear the chime?'), chime, rest(0.8),
  ],

  // Version A: this, then `voiceLine`, which the microphone listens to.
  voice: [title('Voice check'), chime, rest(1.6), say('Listen.'), chime, rest(0.8)],
  // The narrator under test. No instruments: the microphone would take them for the voice.
  voiceLine: [quote('Hello. This is the narrator.')],
  // Version B: Play says `voiceLine`.
  voiceAsk: [
    title('Voice check'), chime, rest(1.6),
    say('Press Play.'), chime, rest(1.6),
    say('Can you hear a voice?'), chime, rest(0.8),
  ],

  motion: [title('Shake test'), chime, rest(1.6), say('Tap Allow motion.'), chime, rest(0.8)],
  motionWatching: [title('Shake test'), chime, rest(1.6), say('Shake your phone gently.'), chime, rest(0.8)],

  ready: [title('You’re ready.'), chime, rest(1.6), say('Keep this screen open.'), chime, rest(0.8)],

  // Read out when a check fails.
  fixes: {
    sound: [
      item({ android: 'Media volume up.', other: 'Silent switch off: no orange.' }), chime, rest(1.6),
      item('Bluetooth off. Headphones out.'), chime, rest(1.6),
      item('Volume up, loud.'), chime, rest(1.6),
      item({ android: '', other: 'Sound from the top, like a call? Close this tab and reopen the link.' }), chime, rest(0.8),
    ],
    soundMeasured: [
      item({ android: 'Media volume up.', other: 'Silent switch off: no orange.' }), chime, rest(1.6),
      item('Bluetooth off. Headphones out.'), chime, rest(1.6),
      item('Volume up until the bar passes the line.'), chime, rest(1.6),
      item({ android: '', other: 'Sound from the top, like a call? Reopen the link, and skip the microphone.' }), chime, rest(0.8),
    ],
    voice: [
      item('Volume up, then Play again.'), chime, rest(1.6),
      item({ android: '', other: 'Sound from the top, like a call? Close this tab and reopen the link.' }), chime, rest(0.8),
    ],
    voiceMeasured: [
      item('Volume up, then Play again.'), chime, rest(1.6),
      item({ android: '', other: 'Sound from the top, like a call? Reopen the link, and skip the microphone.' }), chime, rest(0.8),
    ],
    motion: [
      item('Tap Allow motion again.'), chime, rest(1.6),
      item('Or check site settings.'), chime, rest(0.8),
    ],
  },
} satisfies Record<string, Script | Record<string, Script>>
