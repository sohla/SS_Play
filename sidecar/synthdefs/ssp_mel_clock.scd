// melChair3's Pbind, as a synth.
//
//   \note,   Pseq([0,4,7,11,12,11,7,4].stutter(4), inf)  ->  Dseq, expanded
//   \root,   Pseq([3].stutter(16), inf)                  ->  a constant, 3
//   \octave, 3
//
// `.stutter(4)` repeats each element four times, which is a property of the
// list rather than of the pattern — so it is expanded here rather than needing
// a Demand equivalent. The root sequence is sixteen copies of one number and
// collapses to that number.
//
// Makes no sound. The page spawns a real voice per event, which is what gives
// the overlapping releases an adsr with a 1-second tail needs.
SynthDef(\ssp_mel_clock, { |out = 0, gate = 1, dur = 0.2, level = 0|
    var env, trig, note, freq;

    env = EnvGen.kr(Env.asr(0.01, 1, 0.01), gate, doneAction: 2);

    // `if (rrateMassFiltered > 0.2) resume else pause` in the original. In the
    // graph rather than in a timer, so the gesture is part of the instrument.
    trig = TDuty.ar(dur) * (level > 0.2);

    note = Demand.ar(trig, 0, Dseq([
        0, 0, 0, 0, 4, 4, 4, 4, 7, 7, 7, 7, 11, 11, 11, 11,
        12, 12, 12, 12, 11, 11, 11, 11, 7, 7, 7, 7, 4, 4, 4, 4
    ], inf));

    // octave 3 and root 3: MIDI 36 + 3 + note.
    freq = (note + 39).midicps;

    // dur rides with the event as the sustain time. These Pbinds name no
    // \legato, which in the event system means it defaults to 1 and the gate
    // is held for exactly one step — without it an adsr never reaches its
    // release stage, never frees, and the node count climbs until maxNodes
    // runs out and new notes silently stop arriving.
    SendReply.ar(trig, '/ssp_mel', [freq, dur]);
    Out.ar(out, Silent.ar(2) * env);
},
metadata: (
    specs: (
        // lincurve(0, 1, 0.4, 0.04, -3) in the original.
        dur: ControlSpec(0.04, 0.4, \exp, 0, 0.2),
        // Silent until played, so it does not start on load and never stop on
        // a machine with no sensor to tell it otherwise.
        level: ControlSpec(0, 1, \lin, 0, 0)
    ),
    frozen: (out: 0),
    supplied: (gate: 1)
))
