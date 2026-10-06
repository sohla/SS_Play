// wingChimes3's voice, ported from AirKit unchanged.
//
// Noise whose amplitude is a band-limited impulse train plus a pulse — so the
// "noise" arrives in grains at pulseFreq — through a very narrow bandpass. At
// an rq of a thousandth the filter is barely a filter and more a struck bar,
// which is where the chime comes from.
//
// rq is lagged over a second inside the graph, so the phone can sweep it from
// a hiss to a ringing tone without a zipper.
SynthDef(\ssp_chime, { |out = 0, freq = 1000, pulseFreq = 10, amp = 0, rq = 0.001,
                       att = 0.9, dec = 1.3, sus = 0, rel = 5, gate = 1, numHarms = 200|
    var env, snd;

    env = EnvGen.kr(Env.adsr(att, dec, sus, rel), gate, doneAction: 2);

    snd = BPF.ar(
        WhiteNoise.ar(Blip.ar(pulseFreq, numHarms, 0.7) + LFPulse.ar(pulseFreq, 0, 1, 0.2)),
        [freq, freq + 5],
        Lag.kr(rq, 1));

    snd = snd * env * Lag.kr(amp, 1) * 20;

    // Clipped rather than scaled: with rq this low the filter's gain varies
    // enormously with where the noise lands, and the ceiling is what keeps it
    // playable.
    Out.ar(out, Clip.ar(snd, -0.5, 0.5));
},
metadata: (
    specs: (
        // The phone drives rq over 0.1..0.0005 and amp over 0.05..2.
        rq: ControlSpec(0.0005, 0.2, \exp, 0, 0.001),
        amp: ControlSpec(0, 2, \amp, 0, 0),
        att: ControlSpec(0.01, 4, \exp, 0, 0.9),
        dec: ControlSpec(0.01, 4, \exp, 0, 1.3),
        sus: \unipolar,
        rel: ControlSpec(0.1, 10, \exp, 0, 5),
        numHarms: ControlSpec(1, 400, \lin, 1, 200)
    ),
    frozen: (out: 0),
    supplied: (gate: 1, freq: 1000, pulseFreq: 10)
))
