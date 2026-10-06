// melChair3's `\simple` voice, ported from AirKit.
//
// A sine fed back through itself: LocalIn reads what LocalOut wrote on the
// previous block, so the oscillator phase-modulates with its own output one
// block late. That one-block delay is the whole character — it is why this
// sounds like a struggling organ rather than a sine.
//
// One deviation, and it is forced: `sustain` is renamed `susLevel`. SuperCollider's
// event system computes `sustain` as a *time* and writes it over any argument
// of that name, so the sidecar rejects the original spelling. Nothing reads it
// here, but the rule caught a real bug once and is not worth weakening.
SynthDef(\ssp_mel, { |out = 0, amp = 0.5, freq = 440, gate = 1,
                     attack = 0.03, decay = 0.1, susLevel = 0.1, release = 1.04|
    var env, feedback, sig;

    env = EnvGen.kr(Env.adsr(attack, decay, susLevel, release), gate, doneAction: 2);

    feedback = LocalIn.ar(2);
    // The original writes `SinOsc.ar(freq, li, 0.5) ! 2`, which is four
    // channels: the feedback is already stereo, so the SinOsc is too, and the
    // `! 2` doubles it again. It works in SuperCollider because Out simply
    // writes to four consecutive buses, which on a stereo setup means half the
    // signal lands on buses nothing is listening to.
    sig = SinOsc.ar(freq, feedback, 0.5);
    LocalOut.ar(sig);

    Out.ar(out, sig * env * amp);
},
metadata: (
    specs: (
        attack: ControlSpec(0.001, 1, \exp, 0, 0.03),
        decay: ControlSpec(0.005, 2, \exp, 0, 0.1),
        susLevel: \unipolar,
        release: ControlSpec(0.02, 4, \exp, 0, 1.04)
    ),
    frozen: (),
    supplied: (
        out: 0,
        gate: 1,
        freq: 440,
        amp: 0.5
    )
))
