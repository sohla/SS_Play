// `freq` appears in both specs and supplied.
SynthDef(\ssp__badOverlap, { |out = 0, freq = 440|
    Out.ar(out, Pan2.ar(SinOsc.ar(freq) * EnvGen.kr(Env.linen, doneAction: 2) * 0.1, 0));
},
metadata: (
    specs: (freq: \freq),
    frozen: (out: 0),
    supplied: (freq: 440)
))
