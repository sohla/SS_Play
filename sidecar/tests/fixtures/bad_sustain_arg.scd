// An argument named `sustain`. The event system computes sustain as a time
// (dur * legato * stretch) and sends it to any argument of that name, so this
// silently receives a note length instead of its intended meaning.
SynthDef(\ssp__badSustainArg, { |out = 0, freq = 440, amp = 0.2, gate = 1, sustain = 0.7|
    Out.ar(out, Pan2.ar(SinOsc.ar(freq)
        * EnvGen.kr(Env.adsr(0.01, 0.1, sustain, 0.3), gate, doneAction: 2) * amp, 0));
},
metadata: (
    specs: (amp: \amp, sustain: \unipolar),
    frozen: (out: 0),
    supplied: (freq: 440, gate: 1)
))
