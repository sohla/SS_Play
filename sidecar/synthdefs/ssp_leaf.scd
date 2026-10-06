// leaves' `\syntheticLeaf`, ported from AirKit unchanged.
//
// Granular, and dry. A noise source is chopped into overlapping grains by
// GrainIn, each panned by its own slow noise, with a sparse dust of impulses
// over the top — which is the difference between a hiss and a surface being
// disturbed.
//
// `leafType` crossfades between three noise colours rather than switching: pink
// is soft, brown crinkly, grey crisp. SelectX interpolates, so a position
// between two of them is a mixture rather than a jump.
//
// The bandpass is swept by a slow sine between 7k and 11k, which is what stops
// a steady grain rate sounding like a machine.
SynthDef(\ssp_leaf, { |out = 0, pan = 0, amp = 0.1, gate = 1,
                      grainDur = 0.05, grainRate = 50,
                      filterRQ = 1, dustiness = 0.2, leafType = 0|
    var leafNoise, sig, dust, sweep, env;

    leafNoise = SelectX.ar(leafType, [PinkNoise.ar, BrownNoise.ar, GrayNoise.ar]);

    sig = GrainIn.ar(1, Impulse.ar(grainRate), grainDur, leafNoise, LFNoise1.kr(5));

    dust = Dust.ar(200 * dustiness) * 0.5;
    sweep = SinOsc.kr(0.3, pi).range(7000, 11000);

    sig = BPF.ar(sig + dust, sweep, filterRQ);

    // 4.3 seconds to open, on a Welch curve. This is a texture that arrives
    // rather than starts.
    env = EnvGen.kr(Env.asr(4.3, 1, 2.3, \welch), gate, doneAction: 2);

    Out.ar(out, Pan2.ar(sig * env * amp.lag(0.4), pan));
},
metadata: (
    specs: (
        // Three colours, crossfaded. 0 pink, 1 brown, 2 grey.
        leafType: ControlSpec(0, 2, \lin, 0, 0),
        grainRate: ControlSpec(2, 200, \exp, 0, 50),
        grainDur: ControlSpec(0.005, 0.3, \exp, 0, 0.05),
        dustiness: ControlSpec(0, 2, \lin, 0, 0.2),
        filterRQ: ControlSpec(0.05, 4, \exp, 0, 1),
        amp: \amp,
        pan: \pan
    ),
    frozen: (out: 0),
    supplied: (gate: 1)
))
