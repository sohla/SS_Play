// miniMoog's voice, ported from AirKit.
//
// Three oscillators an inch apart — saw, sine and triangle, each a detuned
// pair — summed, saturated, filtered, saturated again. The doubled tanh is the
// point: the first rounds the stack before the filter sees it, the second
// catches what resonance adds back.
//
// `sustain` renamed `susLevel`, as elsewhere, because the event system computes
// sustain as a time and writes over any argument of that name.
//
// `Out.ar(0, ...)` in the original is hardcoded; it takes an `out` control here
// so it can be routed like everything else.
SynthDef(\ssp_moog, { |out = 0, freq = 440, amp = 0.5, gate = 1,
                      attack = 0.1, decay = 0.2, susLevel = 0.7, release = 0.3,
                      filterFreq = 800, fq = 0.5, pan = 0|
    var env, osc, filt, sig;

    env = EnvGen.kr(Env.adsr(attack, decay, susLevel, release), gate, doneAction: 2);

    osc = Saw.ar([freq, freq * 1.004], 1)
        + SinOsc.ar([freq - 1, freq - 1 * 0.005], 0, 1)
        + LFTri.ar([freq + 1, freq * 1.004], 0, 1);

    filt = RLPF.ar(osc.tanh, filterFreq, fq).tanh;

    // The original writes `Pan2.ar(sig, pan)` where sig is already the stereo
    // pair of detuned oscillators — which is four channels, so on a stereo
    // output you hear the first oscillator of each pair panned and the second
    // lands on buses nothing reads.
    //
    // Balance2 pans between the pair instead, which is what the detuning was
    // for. It is the one place this voice sounds different from the original,
    // and it sounds different because the original was losing half of itself.
    sig = Balance2.ar(filt[0], filt[1], pan, env * amp * 0.5);

    Out.ar(out, sig.tanh);
},
metadata: (
    specs: (
        // The phone drives filterFreq over 60..15000, attack over 0.1..0.0001
        // and release over 0.01..1.
        filterFreq: ControlSpec(60, 15000, \exp, 0, 800),
        attack: ControlSpec(0.0001, 0.5, \exp, 0, 0.1),
        decay: ControlSpec(0.005, 2, \exp, 0, 0.2),
        susLevel: \unipolar,
        release: ControlSpec(0.01, 3, \exp, 0, 0.3),
        fq: ControlSpec(0.05, 1, \exp, 0, 0.5)
    ),
    frozen: (out: 0),
    supplied: (gate: 1, freq: 440, amp: 0.5, pan: 0)
))
