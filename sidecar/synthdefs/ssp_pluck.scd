// pluck1's voice, ported from AirKit unchanged.
//
// Also a single held synth. A Karplus-Strong string excited by an impulse train
// whose rate is `pch`, ring-modulating a sine pair at the same rate — so one
// control moves both how often it is struck and what it sounds like, which is
// why it behaves like an object rather than a patch.
//
// `gate` defaults to 0 in the original and the page opens it, so the voice can
// be created before anything wants to hear it.
SynthDef(\ssp_pluck, { |out = 0, amp = 0, pch = 30, frq = 30, gate = 0|
    var env, sig, dly, plk, ton;

    env = EnvGen.ar(Env.asr(0.1, 1.0, 3.3), gate, doneAction: 2);

    sig = Impulse.ar(pch.linlin(30, 300, 1, 30));
    dly = Decay.ar(sig, 0.01, BrownNoise.ar(0.1));
    plk = Pluck.ar(WhiteNoise.ar, sig, frq.reciprocal, frq.reciprocal, 8, 0.9, 0.7);
    ton = SinOsc.ar([1, 1.03] * pch, 0, ((plk * 1) + (dly * 0.1)) * 2);

    Out.ar(out, ton + (dly * 0.01) * amp.lag(0.2) * env);
},
metadata: (
    specs: (
        // The phone drives pch over 40..190 and frq over 110..210.
        pch: ControlSpec(30, 300, \exp, 0, 30),
        frq: ControlSpec(30, 400, \exp, 0, 30),
        amp: \amp
    ),
    frozen: (out: 0),
    supplied: (gate: 0)
))
