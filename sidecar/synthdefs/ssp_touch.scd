// A voice for a multitouch surface: one synth per finger, held while the finger
// is down.
//
// Env.asr rather than adsr. A touch instrument has no note length to decay
// toward — the finger decides, and an adsr would audibly drop to its sustain
// level a moment after every tap, which reads as the instrument ducking.
//
// `amp` is supplied per touch rather than being a control, because it is the
// vertical position of the finger. `freq` and `pan` likewise: pan follows the
// strip across the screen, so a chord spreads the way it looks.
SynthDef(\ssp_touch, { |out = 0, freq = 220, amp = 0.2, pan = 0, gate = 1,
                       cutoff = 1800, rq = 0.5, detune = 8,
                       attack = 0.01, release = 0.4|
    var env, sig;

    env = EnvGen.kr(Env.asr(attack, 1, release), gate, doneAction: 2);

    // Two saws a few cents apart. The beating between them is most of what
    // makes a bare subtractive voice sound like an instrument rather than a
    // test tone, and it costs one extra oscillator.
    sig = Saw.ar(freq * [1, (detune / 100).midiratio]).sum * 0.5;

    // Ten fingers at once is the design case, so the filter cannot be allowed
    // to self-oscillate: rq near zero makes RLPF blow up, and with voices
    // stacking that arrives as a crack rather than a resonant sweep.
    sig = RLPF.ar(sig, cutoff.clip(40, 16000), rq.clip(0.08, 1));

    // tanh rather than a limiter: sc3-plugins' SPLimiter2 runs in the browser
    // but is not installed in this machine's sclang, so a def using it would
    // fail to compile locally while working once deployed.
    sig = (sig * env * amp).tanh;

    Out.ar(out, Pan2.ar(sig, pan));
},
metadata: (
    specs: (
        // The whole surface shares these: they are set on the group, so moving
        // one changes every note currently sounding.
        cutoff: ControlSpec(80, 12000, \exp, 0, 1800),

        // Reciprocal of Q, so small is resonant. Floored well above zero for
        // the reason in the graph above.
        rq: ControlSpec(0.08, 1, \exp, 0, 0.5),

        // Cents. Zero is a single saw and sounds thin on purpose, so the
        // control has somewhere to travel from.
        detune: ControlSpec(0, 40, \lin, 0, 8),

        attack: ControlSpec(0.001, 1, \exp, 0, 0.01),
        release: ControlSpec(0.02, 3, \exp, 0, 0.4)
    ),

    frozen: (
        out: 0
    ),

    // Everything a finger decides. amp is the vertical position, pan is where
    // the strip sits across the screen, freq is which strip.
    supplied: (
        freq: 220,
        gate: 1,
        amp: 0.2,
        pan: 0
    )
))
