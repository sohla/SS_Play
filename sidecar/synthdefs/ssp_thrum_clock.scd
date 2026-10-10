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
SynthDef(\ssp_thrum_clock, { |out = 0, gate = 1, dur = 0.5, level = 0, strike = 0, freq = 250|
    var env, trig;

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

    // This clock used to carry two demand sequences — five hardness values
    // against seven pitch ratios, so the accents and the pitches only realigned
    // every 35 taps. Both are gone.
    //
    // They were a guess, and the wrong kind: a tap whose pitch and hardness move
    // on their own is a tap you cannot evaluate. Every reading is of a different
    // stimulus, so a hand trying to find the setting that works is comparing
    // things that were never the same. A pattern is worth having once the page
    // is *tuned*; while it is being tuned it is noise in the measurement.
    //
    // So the clock reports the pitch it is given and nothing else. `hard` is an
    // ordinary control on the voice now rather than a value riding each event.
    SendReply.ar(trig, '/ssp_thrum', [freq.clip(60, 600)]);
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

        // The tap layer's own pitch, independent of the other two layers. Wider
        // than the 120-400Hz this used to allow, because "the most felt
        // frequency" is a population average and the only way to find it on one
        // device in one hand is to be able to look outside the average.
        freq: ControlSpec(60, 600, \exp, 0, 250)
    ),
    frozen: (out: 0),
    supplied: (gate: 1)
))
