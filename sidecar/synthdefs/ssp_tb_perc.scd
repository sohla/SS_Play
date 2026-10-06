// trainBass's percussion voice, ported unchanged.
//
// A drum as a pitch envelope rather than a sample: a Line drops the frequency
// to its resting pitch over 20ms, and `tension` says how far above it starts.
// The click is a separate short noise burst, so the attack and the body can be
// balanced against each other.
//
// `gate` is added, as it is for every per-event voice here. The original has
// none because a perc envelope does not need one; the sidecar asks for it of
// every def and the rule has earned its keep, so the control is added rather
// than the rule bent. On a perc envelope a gate is a trigger.
SynthDef(\ssp_tb_perc, { |out = 0, freq = 50, gate = 1, tension = 0.1, decay = 0.5,
                         clickLevel = 0.5, amp = 0.5, dist = 5,
                         filtFreq = 20, filtRes = 0.8, pan = 0|
    var contour, pitch, drum, click, drumEnv, clickEnv, sig;

    contour = Line.kr(1, 0, 0.02);
    pitch = freq * (1 + (contour * tension));

    drum = SinOsc.ar([pitch, pitch * 1.007], LFNoise2.ar([4, 5], 10, -10), 0.5);
    click = LPF.ar(WhiteNoise.ar(1), 1500);

    drumEnv = EnvGen.ar(Env.perc(0.005, decay, curve: -4), gate, doneAction: 2);
    clickEnv = EnvGen.ar(Env.perc(0.001, 0.01), gate, levelScale: clickLevel);

    sig = (drum * drumEnv) + (click * clickEnv);
    sig = (sig * dist).tanh.distort;
    sig = HPF.ar(sig, filtFreq);

    Out.ar(out, Balance2.ar(sig[0], sig[1], pan, amp));
},
metadata: (
    specs: (
        // The phone drives filtFreq over 3..1000.
        filtFreq: ControlSpec(3, 2000, \exp, 0, 20),
        filtRes: ControlSpec(0.1, 2, \exp, 0, 0.8),
        tension: ControlSpec(0, 2, \lin, 0, 0.1),
        clickLevel: \unipolar,
        dist: ControlSpec(1, 20, \exp, 0, 5),
        amp: \amp
    ),
    frozen: (out: 0),
    // decay is derived per event from the octave, so it arrives with the note.
    supplied: (gate: 1, freq: 50, pan: 0, decay: 0.5)
))
