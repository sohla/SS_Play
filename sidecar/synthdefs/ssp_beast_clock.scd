// movingBeast's Pbind, as a synth.
//
//   \legato, Pseq([0.9, 0.6, 0.6, 0.8, 1.0], inf)  ->  Dseq, 5 long
//   \octave, Pseq([1, 3, 2, 4] + 1, inf)           ->  Dseq, 4 long
//   \note,   Pseq([0, 0, 3, 5, 3, 0, -2], inf)     ->  Dseq, 7 long
//   \pan,    Pwhite(-0.35, 0.35)                   ->  Dwhite
//
// Five against four against seven: 140 events before the cycle repeats.
//
// `\scale, Scale.minor` in the original looks like it needs porting and does
// not. A scale converts `\degree` into `\note`, and this Pbind supplies `\note`
// directly — so the scale never participates.
//
// `\legato` is the one thing here with no Demand equivalent, because it is not
// a value but a duration: the event system holds the gate for dur * legato and
// then releases it. The sustain time is computed here and sent with the event,
// and the page releases the gate after it. A few milliseconds of scatter on a
// release is inaudible in a way the same scatter on an attack would not be.
SynthDef(\ssp_beast_clock, { |out = 0, gate = 1, dur = 0.25, level = 0|
    var env, trig, note, octave, legato, pan, freq;

    env = EnvGen.kr(Env.asr(0.01, 1, 0.01), gate, doneAction: 2);

    trig = TDuty.ar(dur) * (level > 0.01);

    note = Demand.ar(trig, 0, Dseq([0, 0, 3, 5, 3, 0, -2], inf));
    octave = Demand.ar(trig, 0, Dseq([2, 4, 3, 5], inf));
    legato = Demand.ar(trig, 0, Dseq([0.9, 0.6, 0.6, 0.8, 1.0], inf));
    pan = Demand.ar(trig, 0, Dwhite(-0.35, 0.35));

    freq = (note + (octave * 12)).midicps;

    // The sustain time rides with the event rather than being recomputed on the
    // page: dur can change between the note starting and its release, and the
    // original's legato is against the dur the event was born with.
    SendReply.ar(trig, '/ssp_beast', [freq, pan, dur * legato]);
    Out.ar(out, Silent.ar(2) * env);
},
metadata: (
    specs: (
        // lincurve(0, 2.5, 0.4, 0.1, -1) in the original.
        dur: ControlSpec(0.1, 0.4, \exp, 0, 0.25),
        level: ControlSpec(0, 1, \lin, 0, 0)
    ),
    frozen: (out: 0),
    supplied: (gate: 1)
))
