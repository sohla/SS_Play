// A plain self-freeing sine. Deliberately simple: the e2e audio assertions use
// it as the known-good signal, so its spectrum has to be unambiguous.
SynthDef(\ssp_sine, { |out = 0, freq = 440, amp = 0.2, pan = 0,
                      attack = 0.01, sustain = 0.5, release = 0.1|
    var env = EnvGen.kr(Env.linen(attack, sustain, release), doneAction: 2);
    Out.ar(out, Pan2.ar(SinOsc.ar(freq) * env * amp, pan));
})
