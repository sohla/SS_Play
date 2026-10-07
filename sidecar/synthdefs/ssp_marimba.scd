// multiBeat5's `\multiBeatSampler`, ported.
//
// A struck bar, pitched by playback rate. Fixed-length envelope with no gate —
// `sustain` is the middle segment's duration, which sclang fills in from
// `dur * legato`, and the port sends explicitly.
//
// MONO SOURCE, AND TWO CHANNELS OUT. The original is a stereo source and four
// channels out.
//
// It reads
//
//     PlayBuf.ar(2, bufnum, rate: [lr, lr * 1.007], ...)
//     Out.ar(out, sig * amp * env)
//
// An array rate expands a 2-channel PlayBuf into **four** channels: two stereo
// copies, one detuned by about 1.2 cents. Four channels then go to a two-channel
// output, so the detuned copy lands on the bus above and is never heard. The
// detune is computed on every note and thrown away.
//
// Folded rather than truncated: the pair is summed, so the detune the author
// wrote is audible. Halved on the way, because summing two copies of the same
// material would otherwise be 6dB louder than the original's single audible
// copy.
//
// The samples are mono, which is the second change and the one that makes the
// page work on a phone at all. Decoded audio has to total under about 3.7MB —
// the stereo set was 6.78MB and stalled an iPhone at the fourth sample — and
// mono alone brings it to 3.39MB with nothing trimmed. What is lost is the
// recording's own stereo image; the detune and the pan both survive, so a struck
// bar still has width and a position.
//
// This does change the sound — it adds a slow beat against itself that was
// previously inaudible, which on a mallet instrument reads as a little more
// body on the tail. To hear only what the original let through, drop the second
// copy (one channel, because the buffer is mono now):
//
//     sig = PlayBuf.ar(1, bufnum, rate: lr, ...);
//
// Fifth def in this collection with this shape. ssp_mel, miniMoog, ssp_gendy and
// ssp_dulcimer all expanded past the channel count their output could carry.
SynthDef(\ssp_marimba, { |out = 0, bufnum = 0, amp = 1, rate = 1, ptch = 1, start = 0, pan = 0,
                         attack = 0.01, sustain = 0.3, release = 1.2|
    var lr, env, pair, sig;

    lr = rate * BufRateScale.kr(bufnum) * ptch;

    env = EnvGen.kr(Env.new([0, 1, 1, 0], [attack, sustain, release]), doneAction: 2);

    // Two mono copies, 1.2 cents apart. An array rate expands PlayBuf, so this
    // is two channels from a one-channel buffer.
    pair = PlayBuf.ar(1, bufnum, rate: [lr, lr * 1.007],
        startPos: start * BufFrames.kr(bufnum), loop: 0);

    // Summed to one, then panned. The beating between the two rates is the
    // point; where it sits in the field is the pan's job.
    sig = (pair[0] + pair[1]) * 0.5;

    Out.ar(out, Pan2.ar(sig, pan, amp * env));
},
metadata: (
    specs: (
        // The lookup asks for -1..+2 semitones; the range is wider so a
        // deliberate stretch is reachable from a slider.
        rate: ControlSpec(0.25, 4, \exp, 0, 1),
        // A second multiplier on the rate, for a continuous bend on top of the
        // note. The original computes it from roll and then leaves the line
        // commented out, so it sits at 1 unless something drives it.
        ptch: ControlSpec(0.5, 2, \exp, 0, 1),
        start: ControlSpec(0, 1, \lin, 0, 0),
        attack: ControlSpec(0.001, 0.5, \exp, 0, 0.01),
        // A duration, not a level.
        sustain: ControlSpec(0.01, 4, \exp, 0, 0.3),
        release: ControlSpec(0.01, 6, \exp, 0, 1.2),
        amp: \amp,
        pan: \pan
    ),
    frozen: (out: 0),
    supplied: (bufnum: 0),
    waives: (
        'has-gate':
            "A fixed-length one-shot, as the original is. Env.new with "
            "doneAction: 2 frees the node itself, so there is nothing for a "
            "gate to release and a struck bar has no sustain to hold.",
        'no-sustain-arg':
            "Load-bearing rather than accidental: the Pbind sets legato 0.8 and "
            "no sustain, so sclang's computed dur * legato becomes this "
            "envelope's middle segment length. The port sends it explicitly."
    )
))
