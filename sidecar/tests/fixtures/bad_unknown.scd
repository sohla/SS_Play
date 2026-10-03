// metadata names `cutoff`, which this SynthDef does not declare — usually a
// rename where only one side was updated.
SynthDef(\ssp__badUnknown, { |out = 0, freq = 440|
    Out.ar(out, Pan2.ar(SinOsc.ar(freq) * EnvGen.kr(Env.linen, doneAction: 2) * 0.1, 0));
},
metadata: (
    specs: (cutoff: \freq),
    frozen: (out: 0),
    supplied: (freq: 440)
))
