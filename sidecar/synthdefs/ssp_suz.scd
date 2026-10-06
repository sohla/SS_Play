// suz1's voice. The same self-feedback as ssp_mel, but two oscillators seven
// thousandths apart rather than one doubled — the beating between them is what
// stops a long note sitting still.
//
// `sustain` renamed to `susLevel`, as in ssp_mel and for the same reason.
SynthDef(\ssp_suz, { |out = 0, amp = 0.8, freq = 440, gate = 1,
                     attack = 0.001, decay = 0.1, susLevel = 0.1, release = 0.59|
    var env, feedback, sig;

    env = EnvGen.kr(Env.adsr(attack, decay, susLevel, release), gate, doneAction: 2);

    feedback = LocalIn.ar(2);
    sig = SinOsc.ar(freq * [1, 1.007], feedback, 0.5);
    LocalOut.ar(sig);

    Out.ar(out, sig * env * amp);
},
metadata: (
    specs: (
        // The phone drives attack and release over 0.008..0.002 and 1.8..0.002.
        // The range starts lower than the curve reaches because the def's own
        // argument default is 0.001, and a spec that excludes the value the
        // synth starts at is a control whose first position is out of bounds.
        attack: ControlSpec(0.001, 0.05, \exp, 0, 0.008),
        decay: ControlSpec(0.005, 2, \exp, 0, 0.1),
        susLevel: \unipolar,
        release: ControlSpec(0.002, 2, \exp, 0, 0.59)
    ),
    frozen: (),
    supplied: (
        out: 0,
        gate: 1,
        freq: 440,
        amp: 0.8
    )
))
