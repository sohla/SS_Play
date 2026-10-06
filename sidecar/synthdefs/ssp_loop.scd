// A buffer, looped.
//
// The simplest thing that holds a sample open: PlayBuf with loop on, an
// envelope that only ever closes when told to, and a filter so a raw recording
// can be made to sit somewhere.
//
// `rate` is a multiplier on the buffer's own playback rate, not a frequency.
// BufRateScale corrects for a buffer whose sample rate differs from the
// server's — without it a 44.1k file plays sharp on a 48k context, which is the
// kind of wrong that sounds like a performance decision until you compare.
//
// loop: 1 and doneAction: 0 on PlayBuf, because a looping player must never
// free its own synth: the gate is what ends it. A doneAction here would make
// the first pass through the buffer the last.
SynthDef(\ssp_loop, { |out = 0, bufnum = 0, amp = 0.3, rate = 1, pan = 0, gate = 1,
                      start = 0, ffreq = 18000, rq = 0.7,
                      attack = 0.02, release = 0.3|
    var env, sig, frames;

    env = EnvGen.kr(Env.asr(attack, 1, release, \sin), gate, doneAction: 2);

    frames = BufFrames.kr(bufnum);

    sig = PlayBuf.ar(
        2,
        bufnum,
        BufRateScale.kr(bufnum) * rate.lag(0.1),
        1,
        // A start point in the buffer, as a fraction. Resolved against the
        // buffer's own length at run time so the control means the same thing
        // whatever is loaded into it.
        startPos: start.clip(0, 0.999) * frames,
        loop: 1,
        doneAction: 0
    );

    // Mono files load as one channel and PlayBuf then returns one, so the
    // channel count is forced to 2 above and the result is summed back to a
    // sensible stereo pair. Without this a mono sample plays only on the left.
    sig = RLPF.ar(sig, ffreq.lag(0.1).clip(80, 20000), rq);

    Out.ar(out, Balance2.ar(sig[0], sig[1], pan, amp.lag(0.1) * env));
},
metadata: (
    specs: (
        // Two octaves either side, and reverse. The negative half is why this is
        // a plain lin spec rather than an exp one.
        rate: ControlSpec(-2, 4, \lin, 0, 1),
        start: ControlSpec(0, 1, \lin, 0, 0),
        ffreq: ControlSpec(80, 20000, \exp, 0, 18000),
        rq: ControlSpec(0.05, 2, \exp, 0, 0.7),
        attack: ControlSpec(0.001, 4, \exp, 0, 0.02),
        release: ControlSpec(0.01, 8, \exp, 0, 0.3),
        amp: \amp,
        pan: \pan
    ),
    frozen: (out: 0),
    supplied: (gate: 1, bufnum: 0)
))
