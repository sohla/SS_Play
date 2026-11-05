// The microphone's level, as a control signal.
//
// Makes no sound. It reads the first hardware input — the mic, once the page
// has connected it to the engine's worklet — follows its amplitude, and writes
// that to a control bus for another synth to `/n_map` onto its own `amp`. So
// the voice that sounds can be any held def, unchanged.
//
// The input buses sit straight after the outputs, so the first one is
// `NumOutputBuses.ir`, not a literal 2: a page that changed the output count
// would otherwise be reading its own output.
//
// The level also goes to the page over OSC, raw and before `gain`, so the
// meter shows what the mic hears rather than what the voice was told.
SynthDef(\ssp_mic_follow, { |out = 0, gate = 1, bus = 0, gain = 2, ceiling = 0.3,
                             attack = 0.01, release = 0.3, rate = 30|
    var env, sig, level;

    env = EnvGen.kr(Env.asr(0.01, 1, 0.05), gate, doneAction: 2);

    sig = In.ar(NumOutputBuses.ir, 1);
    level = Amplitude.kr(sig, attack, release);

    // Clipped, because this is an amp: a shout into a phone held close reads
    // near 1, and `gain` on top of that would push the voice into clipping.
    Out.kr(bus, (level * gain).clip(0, ceiling) * env);

    // Reaches the page as ['/ssp_mic', nodeId, replyId, level].
    SendReply.kr(Impulse.kr(rate), '/ssp_mic', [level]);

    // Keeps the graph alive without contributing to the mix, as the clock
    // defs do.
    Out.ar(out, Silent.ar(2) * env);
},
metadata: (
    specs: (
        // How far the mic's level is multiplied before it becomes an amp.
        gain: ControlSpec(0.1, 20, \exp, 0, 2),
        // The loudest the follower will ever ask for. -10dB, the top of the
        // range multibeat drives `ssp_mb_drone` over.
        ceiling: \amp,
        attack: ControlSpec(0.001, 1, \exp, 0, 0.01),
        release: ControlSpec(0.01, 2, \exp, 0, 0.3)
    ),

    frozen: (
        out: 0,
        // Reports per second to the meter. 30 is the rate the page draws at.
        rate: 30
    ),

    supplied: (
        gate: 1,
        // The control bus the voice is mapped to. The page picks it.
        bus: 0
    )
))
