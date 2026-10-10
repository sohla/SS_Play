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
                           flutFreq = 250, flutRate = 18, flutAmp = 0,
                           flutDecay = 0.012, flutAttack = 0.001, width = 0.5,
                           carFreq = 250, carAmp = 0, guard = 120, amp = 0.9|
    var env, trig, pulse, flutter, carrier, sig;

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

    // Each pulse is its own damped sinusoid. Its length is a control rather than
    // a constant for the reason set out in ssp_thrum_tap: short enough to be
    // unambiguously a pulse is also close to undetectable, because the Pacinian
    // channel integrates energy over time.
    //
    // Above about 80Hz the pulses overlap whatever their length, and the overlap
    // *is* the fusion — the DSP crosses the perceptual boundary on its own, with
    // nothing in the graph testing for it. A long pulse reaches that point
    // sooner, which is a real interaction between two controls and is why they
    // are both on the page rather than one being chosen here.
    pulse = EnvGen.ar(Env.perc(flutAttack, flutDecay, 1, -4), trig) * flutAmp;

    // Two oscillators, and this is the correction that matters most here.
    //
    // These layers used to share one, on the argument that a real actuator has a
    // single resonant frequency and the two being phase-locked was therefore the
    // physical case. True, and useless: it meant the flutter had **no pitch of
    // its own**, so there was no way to find out whether the rate that feels
    // right and the frequency that feels right are the same answer. They are
    // separate questions and the instrument has to be able to ask them
    // separately.
    //
    // The cost is honest. Two oscillators a few Hz apart beat, and the beat is a
    // slow swell in excursion — a tremolo you can feel. Set them to the same
    // number and it goes away; that is now a choice rather than a constraint.
    //
    // Pulse rather than SinOsc: at width 0.5 the fundamental is 4/π of the peak,
    // so a square buys ~27% more excursion than a sine for the same headroom.
    // The DC that comes with any other width is handled by the LeakDC below.
    flutter = Pulse.ar(Lag.kr(flutFreq, 0.08), width.clip(0.02, 0.5)) * pulse;
    carrier = Pulse.ar(Lag.kr(carFreq, 0.08), width.clip(0.02, 0.5)) * carAmp;
    sig = flutter + carrier;

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
        // The flutter's own pitch, which it did not have until it stopped
        // sharing the carrier's oscillator. Same range as the carrier below so
        // the two can be set to each other, and set apart.
        flutFreq: ControlSpec(60, 600, \exp, 0, 250),

        // 4 to 90Hz, chosen to contain both boundaries with room either side.
        // Stopping at 32Hz would leave the fusion unreachable and this page
        // would be two layers wearing three names.
        flutRate: ControlSpec(4, 90, \exp, 0, 18),
        flutAmp: ControlSpec(0, 0.5, \lin, 0, 0),
        flutDecay: ControlSpec(0.003, 0.4, \exp, 0, 0.012),

        // The flutter's onset. At the fused rates this stops being an attack and
        // becomes the shape of the whole waveform, which is a second way to get
        // at the timbre and the reason it is not just tied to flutDecay.
        flutAttack: ControlSpec(0.0002, 0.06, \exp, 0, 0.001),

        // Duty cycle, shared by the flutter and the carrier because they share
        // the oscillator. 0.5 is a square and the most felt; 0.02 is a spike.
        width: ControlSpec(0.02, 0.5, \lin, 0, 0.5),

        // 250Hz is the bottom of the detection-threshold U-curve for glabrous
        // skin and the middle of the Pacinian channel's 250-300Hz maximum. It is
        // the frequency this page was built around — and it is a population
        // average, so the range is now 60-600Hz rather than the old 150-320Hz.
        // Finding where one device in one hand actually works means being able
        // to look outside the average.
        carFreq: ControlSpec(60, 600, \exp, 0, 250),
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
