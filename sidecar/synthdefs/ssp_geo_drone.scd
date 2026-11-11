// A warm, relaxed drone whose fifth can be put out of tune.
//
// A root and a fifth, each a sine with a soft triangle-ish VarSaw under it,
// through a low-pass and a little reverb. The root's two sides are a hair apart,
// so it breathes slowly in stereo whatever happens.
//
// `beat` detunes the fifth by that many Hz. Its second partial then sits 2×beat
// away from the root's third, and the two beat against each other: at 1.5Hz a
// slow, uneasy wobble, at 0 a still, pure fifth. The geo page drives it from
// distance, so arriving is hearing the interval settle.
//
// Everything is lagged by `lag` — two seconds by default — because the controls
// come from GPS, which updates once a second and jumps: unlagged, every fix would
// be an audible step.
SynthDef(\ssp_geo_drone, { |out = 0, gate = 1, amp = 0.08, freq = 146.83, cutoff = 600,
                          beat = 1.5, pan = 0, lag = 2|
    var env, f, b, root, fifth, sig;

    env = EnvGen.kr(Env.asr(4, 1, 6, \sin), gate, doneAction: 2);

    f = freq.lag(lag);
    b = beat.lag(lag);

    root = (SinOsc.ar([f * 0.999, f * 1.001]) * 0.5)
        + VarSaw.ar([f * 0.998, f * 1.002], 0, 0.3, 0.15);
    fifth = (SinOsc.ar(f * 1.5 + b) * 0.25) + VarSaw.ar(f * 1.5 + b, 0, 0.3, 0.08);

    sig = LPF.ar(root + fifth, cutoff.lag(lag).clip(120, 6000));
    sig = sig + (FreeVerb.ar(sig, 1, 0.9, 0.7) * 0.25);

    Out.ar(out, Balance2.ar(sig[0], sig[1], pan.lag(lag), amp.lag(lag) * env));
},
metadata: (
    specs: (
        amp: \amp,
        // D3 by default. Phone speakers do little below ~200Hz; the VarSaw's
        // upper partials are what carry the root there.
        freq: ControlSpec(55, 440, \exp, 0, 146.83),
        cutoff: ControlSpec(120, 6000, \exp, 0, 600),
        beat: ControlSpec(0, 4, \lin, 0, 1.5),
        pan: \pan,
        lag: ControlSpec(0.05, 8, \exp, 0, 2)
    ),

    frozen: (
        out: 0
    ),

    supplied: (
        gate: 1
    )
))
