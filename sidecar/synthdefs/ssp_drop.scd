// One droplet. Ported from airkit's `droplet.sc` personality, unchanged —
// deliberately, so that if the web version sounds different the cause is the
// pattern translation and not a synth quietly rewritten on the way over.
//
// Every control is `supplied`: this def is never played by hand. The clock
// chooses them per drop and the page relays them, so the ranges live on
// ssp_drop_clock where the phone writes to them.
SynthDef(\ssp_drop, { |out = 0, freq = 1000, amp = 0.8, pan = 0, gate = 1,
                      attack = 0.001, decay = 0.05,
                      filterFreq = 3000, filterRQ = 1, wobble = 10|
    var env, sig;

    env = EnvGen.ar(Env.perc(attack, decay), gate);
    sig = SinOsc.ar(freq * LFPar.ar(wobble, pi/2, 0.2, 1)) * env;
    sig = BPF.ar(sig, filterFreq, filterRQ);

    // What frees the node, rather than the envelope: the BPF rings on past the
    // end of a 5ms perc, and a doneAction on the envelope would cut it.
    DetectSilence.ar(sig, doneAction: 2);

    Out.ar(out, PanAz.ar(2, sig, pan, 1, 2, 0.5) * amp);
},
metadata: (
    specs: (
        attack: ControlSpec(0.0005, 0.05, \exp, 0, 0.001)
    ),

    frozen: (),

    // out included: the drops play into a private bus that the reverb reads,
    // so it is a per-event value like the rest rather than something pinned.
    supplied: (
        out: 0,
        gate: 1,
        freq: 1000,
        amp: 0.8,
        pan: 0,
        decay: 0.05,
        filterFreq: 3000,
        filterRQ: 1,
        wobble: 10
    )
))
