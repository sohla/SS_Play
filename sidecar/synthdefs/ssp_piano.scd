// piano1's `\pianoVoice`, ported unchanged.
//
// A stereo one-shot, pitched by playback rate. The library is six samples an
// octave apart, so almost every note is reached by stretching one of them — up
// to six semitones either way, which the p-file picks deliberately as a test of
// how far a nearest-sample lookup can be pushed before it stops sounding like a
// piano.
//
// The envelope has no gate. `Env.new([0, 1, 1, 0], [attack, sustain, release])`
// with doneAction: 2 is fixed-length and frees itself, so `sustain` here is a
// *duration* rather than a level — the middle segment's length. That is the
// original's naming and it is kept, because renaming it would quietly break the
// contract a caller reads.
SynthDef(\ssp_piano, { |out = 0, bufnum = 0, amp = 0.2, rate = 1, start = 0, pan = 0,
                       attack = 0.002, sustain = 0.3, release = 0.2|
    var env, sig;

    env = EnvGen.kr(Env.new([0, 1, 1, 0], [attack, sustain, release]), doneAction: 2);

    sig = PlayBuf.ar(2, bufnum,
        rate: rate * BufRateScale.kr(bufnum),
        startPos: start * BufFrames.kr(bufnum), loop: 0);

    Out.ar(out, Balance2.ar(sig[0], sig[1], pan, amp * env));
},
metadata: (
    specs: (
        // rate carries the pitch: ±6 semitones is 0.707..1.414, and the range
        // here is wider so a deliberate stretch is reachable.
        rate: ControlSpec(0.25, 4, \exp, 0, 1),
        start: ControlSpec(0, 1, \lin, 0, 0),
        attack: ControlSpec(0.001, 0.5, \exp, 0, 0.002),
        // A duration, not a level. See the note above.
        sustain: ControlSpec(0.01, 4, \exp, 0, 0.3),
        release: ControlSpec(0.01, 6, \exp, 0, 0.2),
        amp: \amp,
        pan: \pan
    ),
    frozen: (out: 0),
    supplied: (bufnum: 0),
    waives: (
        'has-gate':
            "A fixed-length one-shot. Env.new with doneAction: 2 frees the node "
            "on its own, so there is nothing for a gate to release and adding "
            "one would mean a note could outlive its own envelope.",
        'no-sustain-arg':
            "Load-bearing in the original rather than accidental: the Pbind "
            "sets legato 1.6 and no sustain, so the event system's computed "
            "dur * legato becomes this envelope's middle segment length. The "
            "port keeps that by sending sustain = dur * 1.6 explicitly."
    )
))
