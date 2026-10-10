// One tap. The voice ssp_thrum_clock spawns per event.
//
// Two signals that do different jobs, which is the whole design of this page:
// a **body** that is felt and barely heard, and a **click** that is heard and
// not felt. They are not a layered effect — they are the same event reaching
// two senses through one speaker, and each one is tuned for the path it takes.
//
//   body   250Hz, 12ms, below the speaker's cutoff  -> excursion, almost no SPL
//   click  2.5kHz, 4ms, well above it               -> SPL, no excursion at all
//
// The reason the split exists is that a microspeaker's system resonance sits
// around 800Hz-1kHz and its output falls 12dB/octave below that. Underneath the
// cutoff the diaphragm's excursion goes roughly constant while radiated level
// falls as f², so the sub-cutoff band is where drive turns into *motion*
// instead of into sound. This def works the speaker in its failure region on
// purpose and then hands the ear a separate, tiny, cheap transient so that an
// event you can feel is also an event you can place in time.
SynthDef(\ssp_thrum_tap, { |out = 0, gate = 1, freq = 250, hard = 0.6,
                           decay = 0.012, amp = 0.5|
    var bodyEnv, body, clickEnv, click, sig;

    // The actuator this page does not have.
    //
    // An LRA is a mass on a spring, so what it does when asked for a tap is a
    // damped sinusoid. Written as an oscillator times an envelope rather than
    // as Ringz struck by an impulse: the two are the same shape, and this one
    // has an amplitude you can predict — which matters when the limit being
    // managed is a physical excursion rather than a loudness.
    //
    // `decay` is the one control on this page that cannot be set correctly from
    // theory, because two findings pull it in opposite directions.
    //
    // A burst stops being felt as a discrete pulse and becomes a continuous
    // vibration at about 25-30ms, near-constant from 40Hz to 590Hz. So **length
    // is what makes this read as a tap**, and under that boundary is where a tap
    // lives.
    //
    // But the Pacinian channel — the one 250Hz addresses, and the only channel
    // that does this — **summates energy over time up to about one second**, so
    // its detection threshold falls as duration rises. A burst short enough to
    // be unambiguously a tap is therefore close to the least detectable thing
    // this transducer can produce, and reported as exactly that: felt-for by a
    // hand that could not find it.
    //
    // Crispness and detectability trade off, the exchange rate depends on the
    // device and the hand, and nothing here can pick the point. So the range is
    // wide on purpose — 3ms to 400ms, both sides of the boundary — and the page
    // puts it on a slider and names where the boundary is.
    bodyEnv = EnvGen.ar(Env.perc(0.0006, decay, 1, -4), gate, doneAction: 2);
    body = SinOsc.ar(freq) * bodyEnv;

    // The audible half. Band-passed noise rather than a tone, because its job is
    // to mark the instant rather than to sound a pitch, and 4ms of noise reads
    // as a click where 4ms of a sine reads as a chirp.
    //
    // Ten times the body's frequency puts it above the speaker's cutoff, where
    // the speaker is efficient and the skin is not — the inverse of the body,
    // deliberately. It scales with `hard` because hitting a real thing harder
    // moves its spectrum up, and because an accent that only gets louder in a
    // band the speaker cannot radiate would be felt and not heard.
    clickEnv = EnvGen.ar(Env.perc(0.0003, 0.004, 1, -8));
    click = BPF.ar(WhiteNoise.ar, (freq * 10).clip(400, 6000), 0.7) * clickEnv * hard;

    sig = (body * (0.45 + (hard * 0.55))) + (click * 0.35);

    // Softclip, and the distortion is wanted rather than tolerated. Harmonics of
    // a 250Hz body land at 500Hz and 750Hz, which is exactly the band the
    // speaker starts to radiate — so clipping transposes energy out of the felt
    // region and into the heard one. A clean limiter here would make a hard tap
    // quieter without making it any less felt.
    sig = (sig * amp).softclip;

    // Mono, both channels in phase, and this is not laziness.
    //
    // A phone with two speakers vibrates one chassis. Anything panned, widened
    // or phase-inverted between the two partly cancels *mechanically* before it
    // ever cancels acoustically, and the loss falls hardest on the low end,
    // which is the only part being felt. Stereo is a cost with no return on a
    // page whose output is a vibration.
    Out.ar(out, sig ! 2);
},
metadata: (
    specs: (
        // Deliberately spans the ~25ms pulse-to-vibration boundary rather than
        // stopping below it. Under 25ms is a tap and hard to feel; over it is
        // easy to feel and not a tap. Both are legitimate places to be and only
        // a hand can say which, so the control crosses the line and the UI says
        // where the line is.
        decay: ControlSpec(0.003, 0.4, \exp, 0, 0.012),
        amp: \amp
    ),
    frozen: (out: 0),
    supplied: (
        gate: 1,
        // Both arrive with the event, from the clock's two demand sequences.
        freq: 250,
        hard: 0.6
    )
))
