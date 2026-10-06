// trainMelody2's voice, ported unchanged.
//
// Three oscillators a hundredth apart — saw, pulse and sine — mixed before the
// filter rather than after, so the resonance works on the sum and the beating
// between them is what it emphasises. tanh after the filter, not before.
SynthDef(\ssp_tm_voice, { |out = 0, freq = 440, gate = 1, amp = 0.8,
                          filtFreq = 2000, filtRes = 0.3,
                          envAtk = 0.01, envDec = 0.1, envSus = 0.7, envRel = 0.2, pan = 0|
    var env, mixed, filtered;

    env = EnvGen.ar(Env.adsr(envAtk, envDec, envSus, envRel), gate, doneAction: 2);

    mixed = Mix([
        Saw.ar(freq, 1.0),
        Pulse.ar(freq * 0.99, 0.5, 0.5),
        SinOsc.ar(freq * 1.01, 0, 1.0),
    ]) * env * amp;

    filtered = RLPF.ar(mixed, filtFreq, filtRes).tanh;

    Out.ar(out, Pan2.ar(filtered, pan));
},
metadata: (
    specs: (
        // The phone drives filtFreq over 50..14000 and filtRes over 0.9..0.2.
        filtFreq: ControlSpec(50, 14000, \exp, 0, 2000),
        filtRes: ControlSpec(0.1, 1, \exp, 0, 0.3),
        envAtk: ControlSpec(0.001, 0.2, \exp, 0, 0.01),
        envDec: ControlSpec(0.01, 1, \exp, 0, 0.1),
        // Zero in the pattern: each note decays rather than holding.
        envSus: \unipolar,
        envRel: ControlSpec(0.02, 4, \exp, 0, 0.2),
        amp: \amp
    ),
    frozen: (out: 0),
    supplied: (gate: 1, freq: 440, pan: 0)
))
