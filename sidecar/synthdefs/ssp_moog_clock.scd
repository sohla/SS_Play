// miniMoog's Pbind, as a synth.
//
//   \note,    Pseq([0, 5, 2, 9, 4], inf)             ->  Dseq, 5 long
//   \octave,  Pseq([1,2,3].stutter(2) + 2, inf)      ->  Dseq, 6 long
//   \root,    Pseq([0,4,8].stutter(60), inf)         ->  Dseq, 180 long
//   \release, Pwhite(0.1, 2.4)                       ->  Dwhite
//   \pan,     Pseq([-0.3, 0.3], inf)                 ->  Dseq, 2 long
//
// Five against six against two, with the key changing every sixty notes: the
// figure takes thirty notes to come back round and 180 before it does so in
// the same key.
SynthDef(\ssp_moog_clock, { |out = 0, gate = 1, dur = 0.2, level = 0|
    var env, trig, note, octave, root, release, pan, freq;

    env = EnvGen.kr(Env.asr(0.01, 1, 0.01), gate, doneAction: 2);

    trig = TDuty.ar(dur) * (level > 0.01);

    note = Demand.ar(trig, 0, Dseq([0, 5, 2, 9, 4], inf));
    octave = Demand.ar(trig, 0, Dseq([3, 3, 4, 4, 5, 5], inf));
    root = Demand.ar(trig, 0, Dseq([0 ! 60, 4 ! 60, 8 ! 60].flatten, inf));
    release = Demand.ar(trig, 0, Dwhite(0.1, 2.4));
    pan = Demand.ar(trig, 0, Dseq([-0.3, 0.3], inf));

    freq = (note + root + (octave * 12)).midicps;

    SendReply.ar(trig, '/ssp_moog', [freq, pan, release, dur]);
    Out.ar(out, Silent.ar(2) * env);
},
metadata: (
    specs: (
        // Fixed at 0.2 in the original's ~next.
        dur: ControlSpec(0.05, 0.8, \exp, 0, 0.2),
        level: ControlSpec(0, 1, \lin, 0, 0)
    ),
    frozen: (out: 0),
    supplied: (gate: 1)
))
