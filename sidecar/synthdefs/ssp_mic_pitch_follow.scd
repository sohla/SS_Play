// The microphone's pitch, as a control signal.
//
// The sibling of `ssp_mic_follow`, which does the level: this reads the same
// first hardware input, tracks its fundamental with `Pitch`, and writes it —
// multiplied by `ratio`, an octave down by default — to a control bus for a
// held voice to `/n_map` onto its `freq`. Silent, like the level follower.
//
// Only a confident reading moves it. `Pitch` reports a frequency every frame
// whether or not there is a note, and a second output saying whether it found
// one. While it has one, the reading passes straight through; otherwise the
// previous value is fed back, so breaths, consonants and silence leave the voice
// on the last note instead of wandering. The feedback starts at `init`, so the
// voice has a pitch before anything has been sung — rather than 0Hz, which a
// Pulse plays as DC.
//
// Not `Latch`, which was the first version: it samples on a *rising* trigger,
// and `hasFreq` rises once and stays up for a held note, so it froze on the
// first reading of every note and ignored the singer sliding off it.
//
// `median` smooths octave jumps, the usual failure of autocorrelation on a
// voice; the range covers a low voice to a whistle.
//
// Reaches the page as ['/ssp_mic_pitch', nodeId, replyId, freq, hasFreq],
// raw and before `ratio`, so the readout shows what was heard.
SynthDef(\ssp_mic_pitch_follow, { |out = 0, gate = 1, bus = 1, ratio = 0.5, init = 220,
                                   floor = 0.02, median = 7, rate = 30|
    var env, sig, freq, hasFreq, held;

    env = EnvGen.kr(Env.asr(0.01, 1, 0.05), gate, doneAction: 2);

    sig = In.ar(NumOutputBuses.ir, 1);
    # freq, hasFreq = Pitch.kr(sig, init, minFreq: 60, maxFreq: 2000,
        median: median, ampThreshold: floor);

    held = Select.kr(hasFreq, [LocalIn.kr(1, init), freq]);
    LocalOut.kr(held);
    Out.kr(bus, held * ratio);

    SendReply.kr(Impulse.kr(rate), '/ssp_mic_pitch', [freq, hasFreq]);

    Out.ar(out, Silent.ar(2) * env);
},
metadata: (
    specs: (
        // 0.5 is an octave down; 1 follows exactly, 0.25 two octaves down.
        ratio: ControlSpec(0.125, 2, \exp, 0, 0.5),
        // The level below which Pitch does not try: room noise, not a note.
        floor: ControlSpec(0.001, 0.2, \exp, 0, 0.02)
    ),

    frozen: (
        out: 0,
        init: 220,
        // Pitch's median window, in frames. Read at construction only.
        median: 7,
        rate: 30
    ),

    supplied: (
        gate: 1,
        bus: 1
    )
))
