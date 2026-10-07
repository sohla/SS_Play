// multiBeat4's `\multiBeatKit`, ported unchanged.
//
// A one-shot kit voice. Nothing here chooses the sample — the pattern hands it a
// bufnum per event, which is what makes one def serve twelve drums.
//
// The stereo comes from the rate rather than from a panner:
// `rate: [lr, lr * 1.2]` expands PlayBuf into two copies of a mono sample at
// different speeds, so the two sides disagree in pitch and length. On a kit that
// reads as width and a little grit rather than as detuning. The commented-out
// Balance2 in the original is a working note, left as one.
//
// RHPF then Compander is doing more than it looks: the high-pass is swept from
// the phone, and the compressor's slopeAbove 0.5 against a low threshold is what
// stops a sweep that lifts the fundamental out of a tom from also making it
// quiet. Expanding below, compressing above.
SynthDef(\ssp_kit, { |out = 0, bufnum = 0, amp = 0.5, rate = 1, start = 0, pan = 0,
                     attack = 0.005, decay = 0.1, sustain = 0.8, release = 0.02,
                     gate = 1, cutoff = 50, rq = 0.01|
    var lr, env, sig;

    lr = rate * BufRateScale.kr(bufnum);
    env = EnvGen.kr(Env.adsr(attack, decay, sustain, release), gate, doneAction: 2);

    sig = PlayBuf.ar(1, bufnum, rate: [lr, lr * 1.2],
        startPos: start * BufFrames.kr(bufnum), loop: 0);

    sig = RHPF.ar(sig, cutoff.clip(20, 8000), rq) * 2;

    sig = Compander.ar(sig, sig,
        thresh: -20.dbamp,
        slopeBelow: 1,
        slopeAbove: 0.5,
        clampTime: 0.01,
        relaxTime: 0.01
    );

    Out.ar(out, sig * amp * env);
},
metadata: (
    specs: (
        // The phone drives cutoff over 40..900 and rate over 0.75..1.25 on top
        // of the pattern's own choice from [1, 1, 1, 0.5, 2, 1.5, -1].
        cutoff: ControlSpec(20, 8000, \exp, 0, 50),
        rq: ControlSpec(0.005, 2, \exp, 0, 0.01),
        rate: ControlSpec(-2, 4, \lin, 0, 1),
        start: ControlSpec(0, 1, \lin, 0, 0),
        attack: ControlSpec(0.001, 0.5, \exp, 0, 0.005),
        decay: ControlSpec(0.005, 2, \exp, 0, 0.1),
        // adsr's sustain is a level, not a time. Which is exactly the collision
        // waived below.
        sustain: ControlSpec(0, 1, \lin, 0, 0.8),
        release: ControlSpec(0.005, 4, \exp, 0, 0.02),
        amp: \amp,
        pan: \pan
    ),
    frozen: (out: 0),
    supplied: (gate: 1, bufnum: 0),
    waives: (
        'no-sustain-arg':
            "adsr's sustain is a level here, and sclang's event system would "
            "overwrite it with a computed time — a real bug in the original, "
            "where a 0.06s dur silently set the sustain level to 0.06. This "
            "page drives the def from the JS conductor, which sends only the "
            "controls it names, so nothing computes a sustain behind its back."
    )
))
