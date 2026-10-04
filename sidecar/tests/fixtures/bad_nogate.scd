// No gate. The event system only sends gate-off when desc.hasGate is true, so
// \legato and \sustain do nothing and the pattern cannot release a note — it
// ends only when its own envelope runs out.
SynthDef(\ssp__badNoGate, { |out = 0, freq = 440, amp = 0.2|
    Out.ar(out, Pan2.ar(SinOsc.ar(freq)
        * EnvGen.kr(Env.linen(0.01, 0.4, 0.1), doneAction: 2) * amp, 0));
},
metadata: (
    specs: (amp: \amp),
    frozen: (out: 0),
    supplied: (freq: 440)
))
