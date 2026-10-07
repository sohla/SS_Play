// dulcimer1's `\dulcimerVoice`, ported.
//
// A struck string, and a small amount of something that is not a string: an
// LFTri pair a tone above the note, frequency-modulated by an LFCub whose rate
// and depth both scale with amp, mixed in at 0.04. Quiet, and the reason the
// instrument has an edge on a hard strike that it does not have on a soft one.
//
// Like ssp_piano, the envelope is fixed-length with no gate — `sustain` here is
// the middle segment's *duration*, which sclang's event system fills in from
// `dur * legato`. The port sends it explicitly.
//
// ONE CHANGE, and it is audible, so it is stated rather than buried.
//
// The original reads
//
//     PlayBuf.ar(2, bufnum, rate: rate * BufRateScale.kr(bufnum) * [1, 1.007], ...)
//
// An array rate expands a 2-channel PlayBuf into **four** channels — two stereo
// copies, one detuned by 0.7 of a cent. The voice then writes four channels to a
// two-channel bus, so the detuned copy lands on the bus above and is never
// heard; what reaches the output is the plain copy alone. The detune is computed
// on every note and thrown away.
//
// This sends the plain copy only, which is what the original sounds like. To
// hear the detune the original intended, sum the pair instead:
//
//     sig = PlayBuf.ar(2, bufnum, rate: lr * [1, 1.007], ...);
//     sig = sig[0] + sig[1];
//
// It is left off because a port should sound like the thing it ports.
SynthDef(\ssp_dulcimer, { |out = 0, bufnum = 0, amp = 0.2, rate = 1, start = 0, pan = 0,
                          attack = 0.002, sustain = 0.2, release = 1.2, freq = 440|
    var env, sig, tone, mix;

    env = EnvGen.kr(Env.new([0, 1, 1, 0], [attack, sustain, release]), doneAction: 2);

    // Mono buffer, so one channel — which the stereo `tone` below expands back
    // to two. The samples are mono and trimmed to 2.1s because decoded audio has
    // to total under about 3.7MB: the stereo 3.0s set was 9.89MB and stalled an
    // iPhone at the fourth sample. Mono alone was still 4.94MB, hence the trim,
    // which takes about half a second off the end of a 2.6s release.
    sig = PlayBuf.ar(1, bufnum,
        rate: rate * BufRateScale.kr(bufnum),
        startPos: start * BufFrames.kr(bufnum), loop: 0);

    // Two octaves up, a cent or so apart, FM'd by a sub-audio cub whose rate and
    // index both follow amp — so the edge arrives with force rather than being
    // always present.
    tone = LFTri.ar(freq * [1, 1.02] * 2 * LFCub.ar(9 * amp, 0, 0.1 * amp, 2), 0, 0.04);

    // One channel plus two expands to two: the sample sits in the middle and the
    // LFTri pair provides the width, which is where it came from anyway.
    mix = (sig + tone) * amp * env;

    Out.ar(out, Balance2.ar(mix[0], mix[1], pan));
},
metadata: (
    specs: (
        // rate carries the pitch; the lookup asks for -7..+2 semitones.
        rate: ControlSpec(0.25, 4, \exp, 0, 1),
        freq: ControlSpec(20, 2000, \exp, 0, 440),
        start: ControlSpec(0, 1, \lin, 0, 0),
        attack: ControlSpec(0.001, 2, \exp, 0, 0.002),
        // A duration, not a level.
        sustain: ControlSpec(0.01, 4, \exp, 0, 0.2),
        release: ControlSpec(0.01, 6, \exp, 0, 1.2),
        amp: \amp,
        pan: \pan
    ),
    frozen: (),
    supplied: (out: 0, bufnum: 0),
    waives: (
        'has-gate':
            "A fixed-length one-shot, as the original is. Env.new with "
            "doneAction: 2 frees the node itself, so there is nothing for a "
            "gate to release.",
        'no-sustain-arg':
            "Load-bearing, not accidental: the Pbind sets legato 0.8 and no "
            "sustain, so sclang's computed dur * legato becomes this "
            "envelope's middle segment length. The port sends it explicitly."
    )
))
