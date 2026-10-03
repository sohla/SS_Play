// Filtered noise, as a contrast to the sine: broadband where the sine is not,
// which is what makes a spectral assertion meaningful rather than tautological.
SynthDef(\ssp_noise, { |out = 0, cutoff = 2000, rq = 0.5, amp = 0.2, pan = 0,
                       attack = 0.01, sustain = 0.5, release = 0.1|
    var env = EnvGen.kr(Env.linen(attack, sustain, release), doneAction: 2);
    Out.ar(out, Pan2.ar(RLPF.ar(WhiteNoise.ar, cutoff, rq) * env * amp, pan));
})
