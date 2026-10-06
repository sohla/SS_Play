// multiBeatSynth1's per-event voice, ported unchanged.
//
// A narrow pulse against a sine an octave down, through a lowpass the phone
// opens. The perc envelope frees the node on its own, so there is nothing to
// release — the page never has to decide when a note ends.
//
// One addition: `gate`. The original has none, because an Env.perc does not
// need one. The sidecar requires it of every def, and the rule has caught a
// real bug before, so the control is added rather than the rule weakened. On a
// perc envelope the gate is a trigger, which costs nothing and leaves the
// behaviour unchanged.
SynthDef(\ssp_mb_voice, { |out = 0, freq = 440, amp = 0.2, pan = 0, gate = 1,
                          attack = 0.005, release = 0.4, ffreq = 3000|
    var env, sig;

    env = EnvGen.kr(Env.perc(attack, release), gate, doneAction: 2);
    sig = Pulse.ar(freq, 0.3, 0.5) + SinOsc.ar(freq / 2, 0, 0.6);
    sig = RLPF.ar(sig, ffreq.clip(80, 12000), 0.4);

    Out.ar(out, Pan2.ar(sig, pan, amp * env));
},
metadata: (
    specs: (
        // The phone drives ffreq over 700..6000 and release over 0.1..1.2.
        ffreq: ControlSpec(80, 12000, \exp, 0, 3000),
        attack: ControlSpec(0.0003, 0.1, \exp, 0, 0.005),
        release: ControlSpec(0.05, 2, \exp, 0, 0.4),
        amp: \amp
    ),
    frozen: (out: 0),
    supplied: (gate: 1, freq: 440, pan: 0)
))
