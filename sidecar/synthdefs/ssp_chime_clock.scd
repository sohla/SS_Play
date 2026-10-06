// wingChimes3's Pbind, as a synth.
//
//   \note,   Prand([0, 7, 11], inf)              ->  Drand
//   \octave, Pwhite(5, 6) - 1                    ->  Diwhite(4, 5)
//   \root,   Pseq([0,3,-4,-1,3].stutter(24), inf) ->  Dseq, expanded
//   \pulseFreq, Pwhite(3, 7)                     ->  Dwhite
//
// The root moves every 24 notes, so the chimes drift through five keys over a
// 120-note cycle while the notes themselves stay random within each.
//
// `m.com.root` in the original is AirKit's shared conductor root across
// devices. There is nothing to share here, so it is left at the sequence.
SynthDef(\ssp_chime_clock, { |out = 0, gate = 1, dur = 0.3, level = 0|
    var env, trig, note, octave, root, pulseFreq, freq;

    env = EnvGen.kr(Env.asr(0.01, 1, 0.01), gate, doneAction: 2);

    // `if (accelMass > 0.1) resume else pause` in the original.
    trig = TDuty.ar(dur) * (level > 0.1);

    note = Demand.ar(trig, 0, Drand([0, 7, 11], inf));
    octave = Demand.ar(trig, 0, Diwhite(4, 5));
    root = Demand.ar(trig, 0, Dseq(
        [0 ! 24, 3 ! 24, -4 ! 24, -1 ! 24, 3 ! 24].flatten, inf));
    pulseFreq = Demand.ar(trig, 0, Dwhite(3, 7));

    freq = (note + root + (octave * 12)).midicps;

    // dur rides along as the sustain time: no \legato, so the event system
    // held the gate for exactly one step, and an adsr needs that to release.
    SendReply.ar(trig, '/ssp_chime', [freq, pulseFreq, dur]);
    Out.ar(out, Silent.ar(2) * env);
},
metadata: (
    specs: (
        // Fixed at 0.3 in the original's ~next; kept adjustable so the phone
        // has something to do beyond amplitude.
        dur: ControlSpec(0.08, 1.2, \exp, 0, 0.3),
        level: ControlSpec(0, 1, \lin, 0, 0)
    ),
    frozen: (out: 0),
    supplied: (gate: 1)
))
