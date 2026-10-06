// A warm drone, held open for as long as a page is looking at it.
//
// Warmth here is three specific things, none of them a filter type: oscillators
// that are never exactly in tune, a pitch that is never exactly still, and a
// gentle saturation that rounds the top of the waveform rather than clipping it.
// A single saw through a lowpass is none of those and sounds like a test tone.
//
// Gated like every def here, but the gate is never released in normal use — the
// page holds one synth for its whole life and moves its controls. doneAction is
// still required, and still correct: the page releases on unmount.
SynthDef(\ssp_drone, { |out = 0, gate = 1, freq = 110, amp = 0.25,
                       cutoff = 900, rq = 0.4, detune = 12, spread = 0.5,
                       shimmer = 8, attack = 1.5, release = 2|
    var env, drift, voices, sub, sig;

    env = EnvGen.kr(Env.asr(attack, 1, release), gate, doneAction: 2);

    // Three independent slow wanders, in cents. Shared randomness would move
    // the oscillators together, which is a vibrato rather than a drift — the
    // point is that they disagree.
    drift = LFNoise2.kr([0.07, 0.11, 0.13]) * shimmer;

    // Detune is symmetric about the fundamental so the perceived pitch stays
    // put as the control opens.
    voices = Saw.ar(freq * (((detune * [-1, 0, 1]) + drift) / 100).midiratio);
    sig = Splay.ar(voices, spread.clip(0, 1));

    // An octave below, sine rather than saw: it fills the bottom without adding
    // harmonics the filter then has to take back out.
    sub = SinOsc.ar(freq * 0.5) * 0.4;

    sig = RLPF.ar(sig + sub, cutoff.clip(60, 16000), rq.clip(0.1, 1));

    // LeakDC before the saturation, not after: tanh on a signal with any DC
    // offset pushes one half of the waveform into the curve harder than the
    // other, which is an asymmetry you hear as a buzz.
    sig = LeakDC.ar(sig);
    sig = (sig * env * amp).tanh;

    Out.ar(out, sig);
},
metadata: (
    // Every one of these is driven by the phone's orientation through
    // mapSpec, so the ranges here are the gesture's whole travel. A range that
    // is too wide makes a tilt do nothing useful for most of its arc.
    specs: (
        // Two and a half octaves. Wider and a small tilt jumps a fifth.
        freq: ControlSpec(55, 330, \exp, 0, 110),

        cutoff: ControlSpec(120, 8000, \exp, 0, 900),
        rq: ControlSpec(0.1, 1, \exp, 0, 0.4),

        // Cents, either side of the fundamental. Past about 40 it stops being
        // one voice and becomes a chord.
        detune: ControlSpec(0, 40, \lin, 0, 12),

        spread: \unipolar,

        // Depth of the drift, in cents. Zero is a static, synthetic-sounding
        // stack; this control is most of what "analogue" means here.
        shimmer: ControlSpec(0, 30, \lin, 0, 8),

        amp: \amp,

        // Seconds. Long by design: the drone fades in rather than arriving.
        attack: ControlSpec(0.05, 6, \exp, 0, 1.5),
        release: ControlSpec(0.05, 8, \exp, 0, 2)
    ),

    frozen: (
        out: 0
    ),

    supplied: (
        gate: 1
    )
))
