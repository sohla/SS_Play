// woiworung1's voice, ported from AirKit unchanged.
//
// One synth, held open for the whole performance — this personality has no
// Pbind at all. Everything it does, it does by moving the controls of a single
// voice, which is the other shape these files come in.
//
// A sine phase-modulated by its own output, where the feedback amount wanders
// on its own slow noise and the modulation index wanders on another. `ch` is
// the rate of that second wander and is what the phone drives: slow is a tone,
// fast is a rattle. Two allpasses smear it.
SynthDef(\ssp_woi, { |out = 0, freq = 1000, amp = 0.5, gate = 1,
                     att = 2.02, dec = 0.3, sus = 1, rel = 4, fb = 1.2, ch = 10|
    var env, snd;

    env = EnvGen.kr(Env.adsr(att, dec, sus, rel), gate, doneAction: 2);

    snd = SinOsc.ar(freq,
        LocalIn.ar(2) * LFNoise1.ar(0.1, 2),
        LFNoise2.ar(ch.lag(0.3), 1.7)
    ).tanh
        // lagud, not lag: rising in a tenth of a second and falling over two,
        // so a flick speaks immediately and then takes its time going away.
        * amp.lagud(0.1, 2.3)
        // Quieter as it goes up. Without this the top of the range is painful
        // at the amplitude the bottom needs.
        * freq.linlin(50, 800, 1, 0.007);

    2.do { snd = AllpassL.ar(snd, 0.3, { 0.1.rand + 0.03 } ! 2, 5) };

    Out.ar(out, snd.tanh * env);
},
metadata: (
    specs: (
        // The phone drives ch over 0.1..10 and amp over 0..0.25.
        ch: ControlSpec(0.1, 10, \exp, 0, 10),
        amp: ControlSpec(0, 1, \amp, 0, 0.5),
        att: ControlSpec(0.01, 6, \exp, 0, 2.02),
        dec: ControlSpec(0.01, 4, \exp, 0, 0.3),
        sus: \unipolar,
        rel: ControlSpec(0.05, 8, \exp, 0, 4),
        fb: ControlSpec(0, 4, \lin, 0, 1.2)
    ),
    frozen: (out: 0),
    supplied: (gate: 1, freq: 1000)
))
