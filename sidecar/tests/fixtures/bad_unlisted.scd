// `pan` is in no category at all, so nothing would ever set it and no UI would
// show it.
SynthDef(\ssp__badUnlisted, { |out = 0, freq = 440, pan = 0|
    Out.ar(out, Pan2.ar(SinOsc.ar(freq) * EnvGen.kr(Env.linen, doneAction: 2) * 0.1, pan));
},
metadata: (
    specs: (),
    frozen: (out: 0),
    supplied: (freq: 440)
))
