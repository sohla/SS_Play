// A cricket's chirp: one note is a short run of pulses, each a ringing tone.
//
// A cricket sings by drawing a scraper across a file on its wing, and each tooth
// strikes the wing into ringing at one frequency. So: an impulse per tooth into a
// resonator, `Ringz`, which rings and dies within a pulse; `pulses` of them at
// `rate` a second make one chirp. A little band-passed noise on each strike is
// the scrape itself.
//
// Insects sing high, so `note` is the page's note three octaves up — middle C
// rings at 2kHz, the top of the page's range at 8kHz — clipped to where a phone
// speaker still has something to give.
//
// Loud on purpose: `tanh` after `drive` squares the pulses off and lifts the
// level towards full scale without clipping hard. `amp` is applied after, so it
// still scales the chirp.
//
// Fixed length with no gate: `pulses / rate` seconds and a short tail, then it
// frees itself, like the Sonic Pi synths it sits beside on the page.
SynthDef(\ssp_insect, { |out = 0, note = 60, amp = 0.5, pan = 0, pulses = 4, rate = 30,
                         ring = 0.015, drive = 4|
    var freq, dur, strike, tone, scrape, sig, env;

    freq = (note + 36).midicps.clip(1500, 9000);
    dur = pulses / rate;

    env = EnvGen.kr(Env.linen(0.001, dur, 0.03), doneAction: 2);

    strike = Impulse.ar(rate) * EnvGen.ar(Env([1, 1, 0], [dur, 0]));
    tone = Ringz.ar(strike, freq * [1, 2.01], ring * [1, 0.5]) * [1, 0.2];
    scrape = BPF.ar(WhiteNoise.ar, freq, 0.3) * Decay2.ar(strike, 0.0005, 0.004) * 0.5;

    sig = (tone.sum + scrape) * drive;
    sig = sig.tanh;

    Out.ar(out, Pan2.ar(sig * env * amp, pan));
},
metadata: (
    specs: (
        // A MIDI note: the page's 48..84, sung three octaves higher.
        note: ControlSpec(24, 96, \lin, 1, 60),
        amp: \amp,
        pan: \pan,
        // Teeth struck in one chirp.
        pulses: ControlSpec(1, 12, \lin, 1, 4),
        // Teeth a second.
        rate: ControlSpec(10, 80, \exp, 0, 30),
        // How long each strike rings, in seconds.
        ring: ControlSpec(0.002, 0.05, \exp, 0, 0.015),
        drive: ControlSpec(1, 10, \exp, 0, 4)
    ),
    frozen: (out: 0),
    waives: (
        'has-gate':
            "A fixed-length one-shot, like the Sonic Pi synths the page plays "
            "beside it. Env.linen with doneAction: 2 frees the node after one "
            "chirp, so there is nothing for a gate to release."
    )
))
