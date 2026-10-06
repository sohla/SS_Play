// multiBeatSynth1's drone, ported unchanged.
//
// The same two oscillators as the voice, held open underneath it for the whole
// performance. Its frequency is lagged, and its amplitude lagged asymmetrically
// — rising in under a tenth of a second and falling over nearly a second — so
// the bed swells with the hand and takes its time going away.
SynthDef(\ssp_mb_drone, { |out = 0, freq = 110, amp = 0.05, pan = 0, gate = 1,
                          attack = 1.0, release = 0.8, ffreq = 1200, lag = 0.1|
    var env, f, sig;

    env = EnvGen.kr(Env.asr(attack, 1, release, \sin), gate, doneAction: 2);

    f = freq.lag(lag);
    sig = Pulse.ar(f, 0.3, 0.5) + SinOsc.ar(f / 2, 0, 0.6);
    sig = RLPF.ar(sig, ffreq.lagud(0.1, 0.3).clip(80, 12000), 0.4);

    Out.ar(out, Pan2.ar(sig, pan, amp.lagud(0.08, 0.9) * env));
},
metadata: (
    specs: (
        // The phone drives ffreq over 500..3000 and amp from silence to -10dB.
        ffreq: ControlSpec(80, 12000, \exp, 0, 1200),
        amp: \amp,
        attack: ControlSpec(0.05, 6, \exp, 0, 1),
        release: ControlSpec(0.05, 6, \exp, 0, 0.8),
        lag: ControlSpec(0.005, 2, \exp, 0, 0.1)
    ),
    frozen: (out: 0),
    supplied: (gate: 1, freq: 110, pan: 0)
))
