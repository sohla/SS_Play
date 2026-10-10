// The tap layer's clock, as a Demand graph.
//
// Layer one of three on /thrum/, and the only one that spawns nodes. The three
// layers are the three vibrotactile channels — this is the slow one: below
// about 6Hz the pulses of a periodic stimulus stay segregated and are felt as
// separate events rather than as a rhythm or a texture. Above that rate they
// start to fuse, which is layer two's job and needs no nodes at all.
//
// So this clock's whole useful range is 0.7 to 8 taps a second. A Demand graph
// is almost overkill for a rate that slow — and is still the right mechanism,
// because what it buys is not speed but exactness: the sequence is pulled by
// the audio clock, so a stalled main thread cannot smear the one layer whose
// events are individually felt.
SynthDef(\ssp_thrum_clock, { |out = 0, gate = 1, dur = 0.5, level = 0, strike = 0, base = 250|
    var env, trig, hard, ratio, freq;

    env = EnvGen.kr(Env.asr(0.01, 1, 0.01), gate, doneAction: 2);

    // Two conditions, and they are not the same question.
    //
    // `level` is whether the hand is doing anything at all. It drives the page's
    // own playing badge and the bed answers to it too, so it is true while the
    // phone is merely being turned. `strike` is whether the hand is *striking*,
    // which is the only gesture this layer belongs to.
    //
    // Gating on both means turning the phone brings up the bed without this
    // clock spawning a node per beat for a tap at zero amplitude. The shell
    // sends `level` to every clock whether or not the graph reads it, so the
    // alternative was a control that exists and does nothing.
    trig = TDuty.ar(dur) * (level > 0.02) * (strike > 0.02);

    // Five against seven: hardness and ratio keep their own positions, so the
    // accent pattern and the pitch pattern only line up again every 35 taps.
    // Two demand sequences pulled by one trigger, with nothing counting for
    // them — the same trick ssp_suz_clock uses at nine against sixteen.
    //
    // Hardness carries the pattern and ratio barely moves, which is the way
    // round the skin needs rather than the way round a melody would want.
    // Vibrotactile frequency discrimination is poor — it is why an LRA is a
    // single-frequency device — while a change in intensity is unmistakable.
    // A tune written into `ratio` would be felt as an even pulse train and
    // heard as a tune, which is the wrong way round for this page.
    hard = Demand.ar(trig, 0, Dseq([1, 0.45, 0.72, 0.5, 0.88], inf));
    ratio = Demand.ar(trig, 0, Dseq([1, 1, 0.72, 1, 1.5, 1, 0.72], inf));

    // Clipped at the graph edge rather than in the page. 90Hz is below the
    // excursion the speaker has to give and 520Hz is above the band the skin is
    // best at, so a `base` arriving from a tilt that someone has since rescaled
    // cannot push the taps out of the useful window.
    freq = (base * ratio).clip(90, 520);

    SendReply.ar(trig, '/ssp_thrum', [freq, hard]);
    Out.ar(out, Silent.ar(2) * env);
},
metadata: (
    specs: (
        // 0.7 to 8 taps a second. The top is deliberately past the ~6Hz
        // segregation rate: crossing it is how you hear and feel the tap layer
        // stop being a series of events, and a range that stopped short of the
        // boundary would hide the one thing this layer demonstrates.
        dur: ControlSpec(0.12, 1.4, \exp, 0, 0.5),
        level: ControlSpec(0, 1, \lin, 0, 0),
        strike: ControlSpec(0, 1, \lin, 0, 0),

        // The tactile band, and 250Hz sits at the bottom of the U-curve for
        // glabrous skin. Both ends are reachable by a phone speaker, which 40Hz
        // is not.
        base: ControlSpec(120, 400, \exp, 0, 250)
    ),
    frozen: (out: 0),
    supplied: (gate: 1)
))
