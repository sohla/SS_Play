// The call: a bird-like down-slur, 5kHz to 2.5kHz in 80ms.
//
// A sweep rather than a held tone because a sweep can be timed: a tone is the
// same at every instant, so a listener can only say roughly when it was, while
// a sweep passes each frequency once. The band 2.5–5kHz is also where a phone
// speaker is loudest and an ear most sensitive, and nowhere near speech.
//
// The sweep is exponential, as XLine is, and `ssp_call_listen` is built against
// exactly these three numbers — they are written as literals in both defs and
// asserted equal by the page's tests through the contracts' `frozen` values.
//
// A sine-shaped envelope (Hann) rather than a hard gate: the edges of a gated
// sweep splatter energy across every band and smear the moment it is heard.
SynthDef(\ssp_call, { |out = 0, amp = 0.3, pan = 0, gate = 1,
                       from = 5000, to = 2500, dur = 0.08|
    var env, sig;

    env = EnvGen.ar(Env.sine(dur), doneAction: 2)
        * EnvGen.kr(Env.asr(0, 1, 0.01), gate, doneAction: 2);
    sig = SinOsc.ar(XLine.ar(from, to, dur));

    Out.ar(out, Pan2.ar(sig * env, pan, amp));
},
metadata: (
    specs: (
        amp: \amp,
        pan: \pan
    ),

    frozen: (
        out: 0,
        // The call itself. Changing these without the listener's bands is a
        // call nothing recognises.
        from: 5000,
        to: 2500,
        dur: 0.08
    ),

    supplied: (
        gate: 1
    )
))
