// The pattern, as a synth.
//
// This is the translation of `droplet.sc`'s Pbind. It makes no sound: it runs
// the demand sequences in the server, where the audio clock keeps them exact,
// and reports each event over OSC so the page can spawn a real drop.
//
// Why not run the sequence in JavaScript. A setInterval accumulates error and
// stutters whenever the main thread is busy; TDuty is clocked by the audio
// graph and never slips. The spawn still crosses to JS and back, so a few
// milliseconds of scatter land on each drop — which for rain is not merely
// tolerable, it is most of what rain sounds like.
//
// What Pbind did per event, and what does it here:
//
//   \note,       Pwhite(2, 40, inf)         ->  Diwhite(2, 40)
//   \filterFreq, Pexprand(90, 2000) * 2     ->  Dwhite over logs, then .exp
//   \filterRQ,   Pwhite(0.5, 1.5, inf)      ->  Dwhite
//   \pan,        Pwhite(-1.0, 1.0, inf)     ->  Dwhite
//
// There is no Dexprand. Sampling a uniform spread of logarithms and taking the
// exponent is what Pexprand does anyway, and doing it after Demand rather than
// inside the demand chain keeps the arithmetic on a held value.
SynthDef(\ssp_drop_clock, { |out = 0, gate = 1, dur = 0.25, level = 0|
    var env, trig, note, freq, filterFreq, filterRQ, pan;

    env = EnvGen.kr(Env.asr(0.01, 1, 0.01), gate, doneAction: 2);

    // `if (amp < 0.21) { amp = 0 }` in the original, which left the pattern
    // running and silent. Here it stops the drops being born at all: hold the
    // phone still and the rain stops, with nothing spawned to be silent with.
    trig = TDuty.ar(dur) * (level > 0.21);

    // \octave 4 in the Pbind, so note 2..40 lands at MIDI 50..88.
    note = Demand.ar(trig, 0, Diwhite(2, 40));
    freq = (note + 48).midicps;

    filterFreq = Demand.ar(trig, 0, Dwhite(log(90), log(2000))).exp * 2;
    filterRQ = Demand.ar(trig, 0, Dwhite(0.5, 1.5));
    pan = Demand.ar(trig, 0, Dwhite(-1.0, 1.0));

    // Reaches the page as ['/ssp_drop', nodeId, replyId, ...values].
    SendReply.ar(trig, '/ssp_drop', [freq, filterFreq, filterRQ, pan]);

    // Keeps the graph alive without contributing to the mix. Without an output
    // the synth is still valid, but this makes the intent legible and costs a
    // multiply by zero.
    Out.ar(out, Silent.ar(2) * env);
},
metadata: (
    // The phone writes here. These are the ranges `~next` mapped onto in the
    // original, expressed once, where the page reads them through mapSpec.
    specs: (
        // linexp(-1, 1, 0.5, 0.075) in the original, as a range with its curve.
        dur: ControlSpec(0.075, 0.5, \exp, 0, 0.25),
        // Below 0.21 the shower stops. The default is zero rather than
        // mid-travel so the instrument is silent until it has been played:
        // otherwise it starts raining the moment it loads and keeps raining
        // forever on anything without a sensor to tell it not to.
        level: ControlSpec(0, 1, \lin, 0, 0)
    ),

    frozen: (
        out: 0
    ),

    supplied: (
        gate: 1
    )
))
