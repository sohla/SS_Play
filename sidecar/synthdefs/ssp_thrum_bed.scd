// Layers two and three of /thrum/, in one held synth.
//
// The three layers of this page are the three vibrotactile channels, each of
// which is a *rate* regime rather than a sound:
//
//   1  taps      below ~6Hz       separate felt events      ssp_thrum_clock
//   2  flutter   16-32Hz          a rhythmic flutter        here, as a pulse train
//   3  carrier   35-500Hz         smooth continuous buzz    here, as a steady tone
//
// Two reasons they are one SynthDef rather than two.
//
// **The honest one.** Excursion is zero-sum. Both layers are asking the same
// diaphragm for the same ±0.4mm of travel, so their sum is the only quantity
// that means anything — two separate limiters, each seeing half the signal,
// would each report headroom while the pair clips. One output stage sees the
// total. The tap layer is outside it on purpose: a tap has to be able to take
// priority, and it does that by ducking this synth from the mapping.
//
// **The shell's one.** `MotionInstrument` sends one control dict to every held
// voice it owns, so two held synths on a page receive each other's controls.
// Unknown control names reaching scsynth is not a thing worth finding out about
// at 30Hz.
//
// Nothing here spawns a node and nothing here crosses to JavaScript. A 16-90Hz
// event rate cannot: the round trip is of the same order as the interval, so
// the rate the hand asked for and the rate the skin receives would be different
// numbers. The pulse train is an Impulse in the graph, and its accents come off
// a demand sequence the train pulls itself — a pattern in the server with no
// OSC traffic at all.
SynthDef(\ssp_thrum_bed, { |out = 0, gate = 1,
                           flutRate = 18, flutAmp = 0, flutDecay = 0.012,
                           carFreq = 250, carAmp = 0, guard = 120, amp = 0.9|
    var env, trig, accent, pulse, osc, sig;

    env = EnvGen.kr(Env.asr(0.06, 1, 0.12), gate, doneAction: 2);

    // The rate is the instrument. Sweeping it from 4Hz to 90Hz crosses two
    // perceptual boundaries in order: separate events give way to a flutter at
    // around 16Hz, and the flutter fuses into a smooth vibration somewhere past
    // 50-80Hz. Those are two phase changes in what the hand is holding, and
    // neither is a change in level or in pitch.
    //
    // Lagged because this is driven by a rotation rate at 30Hz and a stepped
    // pulse rate is audible as a stutter in the stutter.
    trig = Impulse.ar(Lag.kr(flutRate, 0.06));

    // Server-side Demand, pulled by the pulse train itself. Eight steps, so at
    // the flutter rates the cycle is a half-second figure and at the fused rates
    // it becomes a timbre rather than a rhythm — the same sequence doing two
    // different jobs either side of the boundary.
    accent = Demand.ar(trig, 0, Dseq([1, 0.5, 0.75, 0.5, 0.9, 0.5, 0.75, 0.6], inf));

    // Each pulse is its own short damped sinusoid, and stays under the ~25ms
    // pulse-to-vibration threshold so that at low rates the individual pulses
    // are still felt as pulses. Above about 80Hz they overlap and the overlap
    // *is* the fusion — the DSP crosses the perceptual boundary on its own,
    // with nothing in the graph testing for it.
    pulse = EnvGen.ar(Env.perc(0.0006, flutDecay, 1, -4), trig) * accent * flutAmp;

    // One oscillator for both layers, which is a choice and not a saving.
    //
    // A real actuator has one resonant frequency and is driven two ways, so the
    // flutter and the carrier being phase-locked is the physical case. It also
    // means they cannot beat against each other: two oscillators a few Hz apart
    // would sum to a slow swell in *excursion*, which is a tremolo you can feel
    // and did not ask for.
    osc = SinOsc.ar(Lag.kr(carFreq, 0.08));
    sig = osc * (pulse + carAmp);

    // The shared output stage, and the reason the two layers live together.
    //
    // LeakDC first: a sharp envelope on a low sine leaves a DC offset, and DC is
    // pure excursion with no sound and no feeling — it just moves the rest point
    // and steals travel from everything else.
    sig = LeakDC.ar(sig);

    // Then the guard. A hard envelope on a 250Hz tone splatters energy well
    // below the carrier, and under about 100Hz a microspeaker has already run
    // out of travel: that content is distortion bought with headroom that the
    // felt band needed. Specced so it can never be raised far enough to eat the
    // carrier itself.
    sig = HPF.ar(sig, Lag.kr(guard, 0.1));

    // `amp` is the excursion budget, and that is the whole reason it is a
    // separate control from the two layer levels rather than folded into them.
    //
    // `flutAmp` and `carAmp` are what the gesture is *asking for*. This is what
    // the speaker can currently *give*, which is a different quantity and not the
    // page's to decide: the taps have first claim on the travel, so the mapping
    // pulls this down as the hand strikes harder. Keeping the two apart means
    // the plotter can show demand while the readout shows what the budget
    // allowed, and a change to the ducking never has to touch a layer's level.
    //
    // Before the limiter, so the limiter sees what is actually being asked of
    // the diaphragm.
    sig = Limiter.ar(sig * env * amp, 0.92, 0.003);

    // In phase on both channels — see the note in ssp_thrum_tap. Two speakers,
    // one chassis: anything that differs between the sides cancels mechanically
    // before it cancels acoustically.
    Out.ar(out, sig ! 2);
},
metadata: (
    specs: (
        // 4 to 90Hz, chosen to contain both boundaries with room either side.
        // Stopping at 32Hz would leave the fusion unreachable and this page
        // would be two layers wearing three names.
        flutRate: ControlSpec(4, 90, \exp, 0, 18),
        flutAmp: ControlSpec(0, 0.5, \lin, 0, 0),
        flutDecay: ControlSpec(0.004, 0.025, \exp, 0, 0.012),

        // The tactile window. 250Hz is the bottom of the detection-threshold
        // U-curve for glabrous skin and the middle of the Pacinian channel's
        // 250-300Hz maximum, which is also why phone actuators resonate between
        // 150 and 235Hz. It is the one frequency this page is built around.
        carFreq: ControlSpec(150, 320, \exp, 0, 250),
        carAmp: ControlSpec(0, 0.45, \lin, 0, 0),

        // Deliberately cannot reach the carrier's 150Hz floor. A guard that can
        // silence the thing it is guarding is a footgun, not a control.
        guard: ControlSpec(60, 140, \exp, 0, 120),

        // The excursion budget the taps leave behind, not a mix level.
        amp: \amp
    ),
    frozen: (out: 0),
    supplied: (gate: 1)
))
