// suz1's Pbind, as a synth.
//
//   \note,   Pseq([0,-2,4,5,10,12,7,5,2], inf)        ->  Dseq, 9 long
//   \octave, Pseq([4,3,4,5].stutter(4), inf)          ->  Dseq, 16 long
//   \root,   0
//
// Nine against sixteen, so the melody and its register drift apart and only
// meet again every 144 events. That polyrhythm is the piece, and it comes free:
// two demand sequences pulled by one trigger keep their own positions with
// nothing counting for them.
SynthDef(\ssp_suz_clock, { |out = 0, gate = 1, dur = 0.1, level = 0|
    var env, trig, note, octave, freq;

    env = EnvGen.kr(Env.asr(0.01, 1, 0.01), gate, doneAction: 2);

    // `if (accelMassFiltered > 0.015) resume else pause`.
    trig = TDuty.ar(dur) * (level > 0.015);

    note = Demand.ar(trig, 0, Dseq([0, -2, 4, 5, 10, 12, 7, 5, 2], inf));
    octave = Demand.ar(trig, 0, Dseq([
        4, 4, 4, 4, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5
    ], inf));

    // root is 0 in the original: `~next` computes a root index from the gyro
    // and then sets \root to 0 anyway, with the octave mapping commented out.
    // Ported as written rather than as apparently intended.
    freq = (note + (octave * 12)).midicps;

    // dur rides with the event as the sustain time. These Pbinds name no
    // \legato, which in the event system means it defaults to 1 and the gate
    // is held for exactly one step — without it an adsr never reaches its
    // release stage, never frees, and the node count climbs until maxNodes
    // runs out and new notes silently stop arriving.
    SendReply.ar(trig, '/ssp_suz', [freq, dur]);
    Out.ar(out, Silent.ar(2) * env);
},
metadata: (
    specs: (
        // lincurve(0, 1, 0.3, 0.02, -3) in the original.
        dur: ControlSpec(0.02, 0.3, \exp, 0, 0.1),
        level: ControlSpec(0, 1, \lin, 0, 0)
    ),
    frozen: (out: 0),
    supplied: (gate: 1)
))
