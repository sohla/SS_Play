// Filtered noise, as a contrast to the sine: broadband where the sine is not,
// which is what makes a spectral assertion meaningful rather than tautological.
//
// Gated, and the sustain level is `susLevel` rather than `sustain` — see
// ssp_sine.scd for why both of those matter.
SynthDef(\ssp_noise, { |out = 0, cutoff = 2000, rq = 0.5, amp = 0.2, pan = 0, gate = 1,
                       attack = 0.01, decay = 0.1, susLevel = 0.7, release = 0.3|
    var env = EnvGen.kr(Env.adsr(attack, decay, susLevel, release), gate, doneAction: 2);
    Out.ar(out, Pan2.ar(RLPF.ar(WhiteNoise.ar, cutoff, rq) * env * amp, pan));
},
metadata: (
    specs: (
        // Not \freq (20-20000). Below ~60Hz RLPF removes essentially all of the
        // noise and the result is silence; above ~12k it is doing nothing to it.
        // Either end would be a slider position that sounds broken.
        cutoff: ControlSpec(60, 12000, \exp, 0, 2000),

        // Reciprocal of Q, so small is resonant. RLPF goes unstable as rq
        // approaches 0, and above 1 the filter is barely filtering.
        rq: ControlSpec(0.05, 1, \exp, 0, 0.5),

        amp: \amp,
        pan: \pan,

        attack: ControlSpec(0.001, 2, \exp, 0, 0.01),
        decay: ControlSpec(0.001, 2, \exp, 0, 0.1),
        release: ControlSpec(0.001, 2, \exp, 0, 0.3),

        susLevel: \unipolar
    ),

    frozen: (
        out: 0
    ),

    // This def has no pitch, so the pattern's \freq key simply goes unused.
    // The gate still comes from the event.
    supplied: (
        gate: 1
    )
))
