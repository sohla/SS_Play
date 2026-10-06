// movingBeast's voice, ported from AirKit unchanged.
//
// A triangle pair whose phase is modulated by a sine running at a harmonic of
// the fundamental, which is itself fed back through LocalIn. `harm` is rounded
// and lagged so the phone can sweep it without the harmonic number stepping
// audibly; `growl` scales how much of the feedback returns.
//
// tanh on the way out rather than a limiter: sc3-plugins' SPLimiter2 runs in
// the browser but is not installed in this machine's sclang, so a def using it
// would fail to compile locally and work once deployed.
SynthDef(\ssp_beast, { |out = 0, freq = 45, amp = 0.2, gate = 1,
                       atk = 0.003, dec = 0.2, sus = 0.1, rel = 1.2, crv = -2,
                       harm = 3, growl = 0.6, harmLag = 1.4, growlLag = 0.08,
                       detune = 1.003, fbDepth = 2,
                       ffreq = 900, rq = 0.4, pan = 0|
    var env, h, g, feedback, sig;

    env = EnvGen.kr(Env.adsr(atk, dec, sus, rel, 1, crv), gate, doneAction: 2);
    h = harm.clip(1, 24).round.lag(harmLag);
    g = growl.lag(growlLag);

    feedback = LocalIn.ar(2);
    sig = LFTri.ar(freq * [1.0, detune], 0, SinOsc.ar(freq * h, feedback * g, fbDepth));
    LocalOut.ar(sig);

    sig = RLPF.ar(sig, ffreq.clip(40, 18000).lag(0.05), rq);
    sig = Balance2.ar(sig[0], sig[1], pan, env * amp);

    Out.ar(out, sig.tanh);
},
metadata: (
    // The phone drives ffreq, fbDepth, harm, growl and rel directly, so these
    // ranges are the ones its curves reach.
    specs: (
        atk: ControlSpec(0.001, 0.5, \exp, 0, 0.003),
        dec: ControlSpec(0.01, 2, \exp, 0, 0.2),
        sus: \unipolar,
        rel: ControlSpec(0.05, 4, \exp, 0, 1.2),
        crv: ControlSpec(-8, 8, \lin, 0, -2),
        harm: ControlSpec(1, 24, \lin, 0, 3),
        growl: ControlSpec(0, 4, \lin, 0, 0.6),
        harmLag: ControlSpec(0.01, 4, \exp, 0, 1.4),
        growlLag: ControlSpec(0.005, 1, \exp, 0, 0.08),
        detune: ControlSpec(1, 1.02, \lin, 0, 1.003),
        fbDepth: ControlSpec(0, 4, \lin, 0, 2),
        ffreq: ControlSpec(100, 4000, \exp, 0, 900),
        rq: ControlSpec(0.05, 1, \exp, 0, 0.4)
    ),
    frozen: (),
    supplied: (
        out: 0,
        gate: 1,
        freq: 45,
        amp: 0.2,
        pan: 0
    )
))
