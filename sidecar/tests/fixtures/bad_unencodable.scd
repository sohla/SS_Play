// \db resolves to a real ControlSpec, but its minval is -inf, so the contract
// cannot be written to JSON and no page could draw a control for it.
SynthDef(\ssp__badUnencodable, { |out = 0, level = 0.5|
    Out.ar(out, Pan2.ar(SinOsc.ar(440) * EnvGen.kr(Env.linen, doneAction: 2) * level, 0));
},
metadata: (
    specs: (level: \db),
    frozen: (out: 0),
    supplied: ()
))
