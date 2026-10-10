// One haptic pulse, with every parameter the research says matters exposed.
//
// This replaces three defs — a clock, a tap voice and a two-layer bed. The
// three-layer version was structurally fine and *unfeelable*, and the reason was
// always the same: the layers were adjustable and the pulse itself was not. Its
// shape was baked in. So there is one layer now, and the pulse has nine
// controls.
//
// ## The shape, and why it is two parts
//
// A tactile event is an **impulse followed by a decaying tone**, which is what a
// real actuator physically does and what this now models directly:
//
//   transient   a few ms of band-passed noise   -> the edge, mostly heard
//   tone        a decaying sinusoid at ~250Hz   -> the body, mostly felt
//   overdrive   a brief boost on the onset      -> gets the mass moving
//
// The overdrive is not a metaphor. LRA drivers like TI's DRV2605 apply a short
// higher-voltage kick at onset specifically to overcome the actuator's inertia,
// because a mass on a spring takes time to reach amplitude and a click that
// takes 20ms to arrive is not a click. A speaker diaphragm has the same problem,
// so the same trick applies: `overdrive` multiplies the first few milliseconds
// and nothing else.
//
// The matching technique, **braking** — driving the actuator in antiphase to
// stop the mass dead — is deliberately *not* here. It exists because a physical
// mass keeps ringing after the drive stops; a synthesised envelope does not, so
// braking and "shorten the decay" are the same control, and only one of them
// should be on the page.
//
// ## The numbers, and where each comes from
//
//   carrier   250Hz    the minimum of the vibrotactile threshold curve for
//                      glabrous skin, and the middle of the Pacinian channel's
//                      250-300Hz maximum. Phone LRAs sit at 125-300Hz for the
//                      same reason.
//   decay     60ms     above the 25-30ms boundary at which a burst stops being
//                      felt as a discrete pulse — deliberately. The Pacinian
//                      channel summates energy over about a second, so its
//                      detection threshold *falls* as duration rises: a burst
//                      short enough to read as a crisp tap is also close to
//                      undetectable. 60ms is the compromise, and it is a
//                      compromise rather than an optimum.
//   intensity 0.75     applied as `intensity ** (1/0.6)`, because subjective
//                      magnitude grows as amplitude^0.6 at 250Hz on the finger.
//                      The exponent is frequency-dependent — 0.95 at 60Hz — so
//                      this is the correction for *this* carrier. Without it the
//                      bottom of the slider does almost nothing and the top does
//                      almost nothing, which is how a linear amplitude control
//                      feels when the ear or the hand is compressive.
//   sharpness 0.5      Core Haptics' own parameter, where it is described as the
//                      "clickiness" of a transient. Here it is literally the
//                      band the transient lives in, 400Hz to 6kHz.
//   rate      4Hz      below the ~6.3Hz critical segregation rate, so pulses
//                      arrive as countable events. Sweeping up crosses flutter
//                      (16-32Hz) and fusion (past ~80Hz).
SynthDef(\ssp_thrum, { |out = 0, gate = 1,
                       carrier = 250, rate = 4, intensity = 0.75,
                       attack = 0.001, decay = 0.06, curve = -4,
                       overdrive = 1, transient = 0.3, sharpness = 0.5,
                       amp = 1|
    var env, trig, level, body, kick, shape, tone, click, sig;

    env = EnvGen.kr(Env.asr(0.05, 1, 0.08), gate, doneAction: 2);

    // Lagged because this is driven at 30Hz from a page and a stepped retrigger
    // rate is audible as a stutter in the stutter.
    trig = Impulse.ar(Lag.kr(rate, 0.05));

    // Stevens' power law, inverted. Perceived magnitude goes as amplitude^0.6
    // at this carrier, so raising the control to 1/0.6 makes the slider
    // perceptually straight rather than physically straight.
    level = intensity.clip(0, 1) ** (1 / 0.6);

    // The decaying tone — the felt half. `curve` is a control rather than a
    // constant because the difference between an exponential decay and a linear
    // one is the difference between a struck object and a fading one, and
    // nothing in the literature says which a hand prefers.
    body = EnvGen.ar(Env.perc(attack, decay, 1, curve), trig);

    // The overdrive kick. Four milliseconds, fixed: this is not a tuning
    // parameter but a model of an actuator's start-up, and its length is set by
    // how long a diaphragm takes to reach amplitude rather than by taste. What
    // is adjustable is how hard it kicks.
    kick = EnvGen.ar(Env.perc(0.0002, 0.004, 1, -8), trig);
    shape = body * (1 + (kick * (overdrive - 1)));

    tone = SinOsc.ar(Lag.kr(carrier, 0.05)) * shape;

    // The transient — the heard half, and the edge that lets a felt event be
    // placed in time. Noise rather than a tone because 6ms of noise reads as a
    // click where 6ms of a sine reads as a chirp.
    click = BPF.ar(WhiteNoise.ar, sharpness.clip(0, 1).linexp(0, 1, 400, 6000), 0.6)
        * EnvGen.ar(Env.perc(0.0003, 0.006, 1, -8), trig)
        * transient;

    sig = (tone + click) * level * amp;

    // DC first: a sharp envelope on a low sinusoid leaves an offset, and DC is
    // pure excursion with no sound and no sensation — it shifts the diaphragm's
    // rest point and steals travel from everything else.
    sig = LeakDC.ar(sig);

    // Softclip, and the distortion is wanted. Harmonics of a 250Hz body land at
    // 500 and 750Hz, which is where a microspeaker starts to radiate, so
    // clipping moves energy out of the felt band and into the heard one. It is
    // also what makes `overdrive` audible as well as palpable.
    sig = sig.softclip;

    sig = Limiter.ar(sig * env, 0.95, 0.002);

    // Mono, both channels in phase. A phone with two speakers vibrates one
    // chassis, so anything that differs between the sides cancels mechanically
    // before it cancels acoustically — and the loss falls hardest on the low
    // end, which is the only part being felt.
    Out.ar(out, sig ! 2);
},
metadata: (
    specs: (
        // Wider than the Pacinian optimum on both sides. 250Hz is a population
        // average and a hand is not a population; the only way to find out where
        // one device works is to be able to look outside the average.
        carrier: ControlSpec(60, 600, \exp, 0, 250),

        // 0.5Hz to 90Hz: one every two seconds, up through the flutter band and
        // past the fusion point.
        rate: ControlSpec(0.5, 90, \exp, 0, 4),

        intensity: ControlSpec(0, 1, \lin, 0, 0.75),

        // 0.1ms to 50ms. The bottom is a click; the top has no transient left
        // and the pulse swells in.
        attack: ControlSpec(0.0001, 0.05, \exp, 0, 0.001),

        // 3ms to 500ms, spanning the 25-30ms tap/vibration boundary and running
        // well into the region where Pacinian summation is still improving
        // detection.
        decay: ControlSpec(0.003, 0.5, \exp, 0, 0.06),

        // Negative is a resonant decay — fast at first, long tail. Positive
        // holds then drops. Zero is linear.
        curve: ControlSpec(-8, 4, \lin, 0, -4),

        // 1 is no boost. 6 is a six-fold kick on the first 4ms, which the
        // softclip turns into harmonics as well as excursion.
        overdrive: ControlSpec(1, 6, \lin, 0, 1),

        transient: ControlSpec(0, 1, \lin, 0, 0.3),
        sharpness: ControlSpec(0, 1, \lin, 0, 0.5),
        amp: \amp
    ),
    frozen: (out: 0),
    supplied: (gate: 1)
))
