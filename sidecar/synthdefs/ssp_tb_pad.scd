// trainBass's pad, held open under the percussion.
//
// Eight oscillator pairs, each a thousandth sharper than the last and panned a
// little further out, so the stack spreads in pitch and across the field at the
// same rate. A filter swept by a sine the phone controls the speed of, a chorus
// of two allpasses, a triangle sub, and the whole thing amplitude-modulated by
// a slow cubic — the pulse that makes it breathe rather than sit.
//
// `freq.lag(3)` is three seconds: a key change arrives as a slide, not a jump.
SynthDef(\ssp_tb_pad, { |out = 0, gate = 1, freq = 440, amp = 0.1,
                        atk = 0.03, dec = 0.2, sus = 0.8, rel = 1.0,
                        filtMin = 500, filtMax = 5000, filtSpeed = 0.5,
                        detuneAmount = 0.001, chorusRate = 0.5, chorusDepth = 0.01,
                        pan = 0, spread = 0.2, lfoFreq = 1|
    var pulse, env, lagged, sig, filt, chorus, sub;
    var numVoices = 8;

    pulse = LFCub.ar(lfoFreq, pi, 0.5, 0.5);
    env = EnvGen.kr(Env.adsr(atk, dec, sus, rel), gate, doneAction: 2);
    lagged = freq.lag(3);

    sig = Array.fill(numVoices, { |i|
        var detune = i * detuneAmount;
        var osc = SinOsc.ar(lagged * (1 + detune))
            + (Saw.ar(lagged * (1 + detune), pi / 2 * i) * 0.3);
        Pan2.ar(osc, pan + detune)
    }).sum;

    filt = SinOsc.kr(filtSpeed).range(filtMin, filtMax);
    sig = RLPF.ar(sig, filt, 0.5);

    // Allpass rather than a delay line: the comb of a short modulated delay is
    // what makes a chorus sound like a flanger, and this keeps the phase
    // movement without the notches.
    chorus = Array.fill(2, {
        var delayTime = SinOsc.kr(chorusRate + rand(0.1), rrand(0, 2pi)).range(0, chorusDepth);
        AllpassC.ar(sig, 0.05, delayTime + (chorusDepth * 0.1), 0.1)
    });

    sub = LFTri.ar(lagged / 2, pi, 0.3).tanh;
    sig = Mix([sig, chorus.sum]) / (numVoices + 2);
    sig = Splay.ar(sig, spread);

    Out.ar(out, (sig + sub) * amp.lag(0.3) * env * pulse);
},
metadata: (
    specs: (
        // The phone drives filtSpeed over 0.1..20 and lfoFreq over 0.1..18.
        filtSpeed: ControlSpec(0.05, 24, \exp, 0, 0.5),
        lfoFreq: ControlSpec(0.05, 20, \exp, 0, 1),
        filtMin: ControlSpec(60, 4000, \exp, 0, 500),
        filtMax: ControlSpec(500, 16000, \exp, 0, 5000),
        detuneAmount: ControlSpec(0, 0.02, \lin, 0, 0.001),
        chorusRate: ControlSpec(0.05, 8, \exp, 0, 0.5),
        chorusDepth: ControlSpec(0, 0.05, \lin, 0, 0.01),
        spread: \unipolar,
        amp: \amp,
        atk: ControlSpec(0.005, 4, \exp, 0, 0.03),
        dec: ControlSpec(0.01, 4, \exp, 0, 0.2),
        sus: \unipolar,
        rel: ControlSpec(0.05, 8, \exp, 0, 1)
    ),
    frozen: (out: 0),
    supplied: (gate: 1, freq: 440, pan: 0)
))
