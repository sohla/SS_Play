// A warm, relaxed drone whose fifth can be put out of tune.
//
// A root and a fifth, each a sine with a soft VarSaw over it, through a steep
// low-pass and a little reverb. The root's two sides are a hair apart,
// so it breathes slowly in stereo whatever happens.
//
// Most of the level is in the VarSaws, not the sines. The first version had it
// the other way round — sines at 0.5 and 0.25, saws at 0.15 and 0.08 — and a
// low-pass can do nothing to a sine below its cutoff, so sweeping the filter
// across four octaves changed a quarter of the sound and read as barely moving.
//
// `beat` detunes the fifth by that many Hz. Its second partial then sits 2×beat
// away from the root's third, and the two beat against each other: at 1.5Hz a
// slow, uneasy wobble, at 0 a still, pure fifth. The geo page drives it from
// distance, so arriving is hearing the interval settle.
//
// The GPS-driven controls are lagged by `lag` — two seconds by default — because
// GPS updates once a second and jumps: unlagged, every fix would be an audible
// step. The cutoff and pan follow the compass instead, which is smooth and fast,
// so they get their own, much shorter `turn` lag: turning the phone is heard as
// you turn it.
SynthDef(\ssp_geo_drone, { |out = 0, gate = 1, amp = 0.08, freq = 146.83, cutoff = 600,
                          beat = 1.5, pan = 0, lag = 2, turn = 0.3|
    var env, f, b, root, fifth, sig;

    env = EnvGen.kr(Env.asr(4, 1, 6, \sin), gate, doneAction: 2);

    f = freq.lag(lag);
    b = beat.lag(lag);

    root = (SinOsc.ar([f * 0.999, f * 1.001]) * 0.2)
        + VarSaw.ar([f * 0.998, f * 1.002], 0, 0.3, 0.4);
    fifth = (SinOsc.ar(f * 1.5 + b) * 0.1) + VarSaw.ar(f * 1.5 + b, 0, 0.3, 0.25);

    // Two LPFs, four poles: steep enough that facing away is properly dark.
    // Not resonant — an RLPF was tried, and its peak sat on the root when the
    // cutoff was low, so facing *away* came out louder than facing the target.
    // Without it, opening the filter adds level as well as brightness.
    //
    // ×4 after it, because the four oscillators, filtered and panned to the
    // centre, peaked near a third of `amp`: at the page's top level of 0.35 that
    // was -20dBFS, and a phone speaker made it a whisper. Measured in the browser
    // engine at amp 0.35 with this gain: peak ~0.33 facing away, ~0.46 facing.
    sig = LPF.ar(LPF.ar(root + fifth, cutoff.lag(turn).clip(120, 8000)), cutoff.lag(turn).clip(120, 8000)) * 4;
    sig = sig + (FreeVerb.ar(sig, 1, 0.9, 0.7) * 0.25);

    Out.ar(out, Balance2.ar(sig[0], sig[1], pan.lag(turn), amp.lag(lag) * env));
},
metadata: (
    specs: (
        amp: \amp,
        // D3 by default. Phone speakers do little below ~200Hz; the VarSaw's
        // upper partials are what carry the root there.
        freq: ControlSpec(55, 440, \exp, 0, 146.83),
        cutoff: ControlSpec(120, 8000, \exp, 0, 600),
        beat: ControlSpec(0, 4, \lin, 0, 1.5),
        pan: \pan,
        lag: ControlSpec(0.05, 8, \exp, 0, 2),
        turn: ControlSpec(0.02, 4, \exp, 0, 0.3)
    ),

    frozen: (
        out: 0
    ),

    supplied: (
        gate: 1
    )
))
