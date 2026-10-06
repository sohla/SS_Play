// gendy2's `\sheet1`, ported from AirKit.
//
// Twenty instances of Xenakis's dynamic stochastic synthesis, spread across the
// field. Gendy1 does not play a waveform — it generates one, by a random walk
// over a handful of breakpoints, so the timbre is never the same twice and
// never quite settles. Twenty of them at slightly different frequencies is a
// swarm rather than a chord.
//
// The file defines this and then never plays it: `~init` instantiates a
// miniMoog instead. The mapping gives the intent away, because `detune` and
// `rtime` are this def's parameters and mean nothing to a miniMoog — the init
// line looks swapped to a stand-in. This is the voice the file is named for.
//
// One line not carried over. The original ends with
//
//     BLowShelf.ar(sig, 400, db: -8);
//     Out.ar(out, sig);
//
// and the shelf's result is discarded — it is computed and thrown away, so it
// never shaped anything. Left out rather than applied, because applying it
// would take 8dB off the bottom and change a sound that this is meant to
// reproduce. Worth a minute with the slider if the low end is too much.
SynthDef(\ssp_gendy, { |out = 0, gate = 1, amp = 0, freq = 45, detune = 0.01, rtime = 1|
    var env, swarm, follow, sig;

    env = EnvGen.ar(Env.asr(0.3, 1.0, 8.0), gate, doneAction: 2);

    swarm = Splay.ar(
        { Gendy1.ar(1, 0, 0.001, 1, freq, freq + (freq * detune), 0, 0.0, mul: 0.1) } ! 20
    ).softclip;

    // Amplitude of a control rather than of a signal: a slew limiter in
    // disguise, rising over 0.1s and falling over 0.4s, so the phone cannot
    // step the level and click.
    follow = Amplitude.kr(amp, 0.1, 0.4);

    // Summed to mono before the reverb. GVerb takes one channel and returns
    // two, so handing it Splay's pair expands into two reverbs and four
    // channels — of which a stereo output plays the first, meaning the original
    // hears the reverb of the left side only. GVerb makes its own stereo image,
    // so the width survives; what is lost is the Splay positions, which were
    // already being thrown away.
    sig = GVerb.ar(swarm.sum * 0.5 * env * follow, 1, rtime).distort;

    Out.ar(out, sig);
},
metadata: (
    specs: (
        // The phone drives detune over 0.1..0.2 and picks freq from a list.
        freq: ControlSpec(20, 400, \exp, 0, 45),
        detune: ControlSpec(0, 0.5, \lin, 0, 0.01),
        rtime: ControlSpec(0.1, 20, \exp, 0, 1),
        amp: \amp
    ),
    frozen: (out: 0),
    supplied: (gate: 1)
))
