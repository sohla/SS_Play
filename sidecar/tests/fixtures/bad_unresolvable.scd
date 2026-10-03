// `freq` carries a spec entry that is neither a ControlSpec, a known symbol,
// nor an array, so no range can be derived and no slider can be drawn.
SynthDef(\ssp__badUnresolvable, { |out = 0, freq = 440|
    Out.ar(out, Pan2.ar(SinOsc.ar(freq) * EnvGen.kr(Env.linen, doneAction: 2) * 0.1, 0));
},
metadata: (
    specs: (freq: \notARealSpecName),
    frozen: (out: 0),
    supplied: ()
))
