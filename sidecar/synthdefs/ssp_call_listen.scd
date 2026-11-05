// Listens for `ssp_call`, and says exactly when it heard one.
//
// Spectrogram template matching, the way bioacoustics finds a species' call in
// hours of field recording — reduced to eight bands. Each band sits on one
// point of the sweep. A call passes the top band first and the bottom band last,
// so each band's level is delayed by how much earlier the sweep reaches it: for
// the real call, all eight then peak at the same instant, at the end of it.
//
// The test is how many bands are lit *together* once aligned: within `lit` of
// the loudest at that instant, at least `need` of the eight. A held tone lights
// one band, with its neighbours far down its filter skirts; a clap or a door
// lights every band at once, which after the delays overlaps only a few; an
// upward sweep spreads out instead of lining up. A whistled down-slur in about
// the right range lights most of them, which is the "or similar" — a person can
// join in.
//
// Counting rather than averaging is deliberate. An average of per-band levels
// against their backgrounds was the first version, and in a quiet room every
// band with any energy at all saturated it: it fired on a noise burst, a tone's
// onset and release, and a sweep the wrong way, as often as on the call.
//
// The aligned peak must also stand `threshold` times above its own background,
// which rises slowly and falls fast — following the room's quiet without a call
// ever lifting it much — so a noisy room raises the bar instead of firing.
//
// No Convolution UGen: the browser build of scsynth has none, so a true matched
// filter is not available. This is the incoherent version of one.
//
// Reaches the page as ['/ssp_heard', nodeId, replyId, frame, bands]. `frame` is
// a sample counter, wrapped at 2^22 — 87s at 48kHz, and below 2^24 so a float32
// holds it exactly. It is what makes the timing sample-accurate however late the
// message itself arrives.
SynthDef(\ssp_call_listen, { |out = 0, gate = 1, in = 2, threshold = 4, lit = 0.2,
                              need = 6, holdoff = 0.05, floor = 0.001|
    var from = 5000, to = 2500, dur = 0.08, bands = 8;
    var env, sig, aligned, peak, together, clear, trig;

    env = EnvGen.kr(Env.asr(0.01, 1, 0.05), gate, doneAction: 2);

    sig = HPF.ar(In.ar(in, 1), 1500);

    aligned = Array.fill(bands, { |k|
        var at = (k + 0.5) / bands;
        // rq 0.05: narrow enough that a held tone reaches only the bands either
        // side of its own above `lit`, three in all. At 0.1 it reached five, and
        // at its onset six, which fired. The sweep crosses each band in ~10ms,
        // which a 250Hz-wide filter still follows.
        var level = Amplitude.ar(BPF.ar(sig, from * ((to / from) ** at), 0.05), 0.002, 0.02);
        DelayN.ar(level, dur, dur * (1 - at));
    });

    peak = aligned.reduce(\max);
    together = aligned.sum { |level| level > (peak * lit) };
    clear = peak > ((LagUD.ar(peak, 2, 0.3) * threshold) + floor);

    // The first moment both hold, then deaf for `holdoff`: a room returns every
    // call as a run of reflections, and the direct path is the earliest of them.
    trig = Trig1.ar((together >= need) * clear, holdoff);

    SendReply.ar(trig, '/ssp_heard', [Phasor.ar(0, 1, 0, 2 ** 22), together]);

    Out.ar(out, Silent.ar(2) * env);
},
metadata: (
    specs: (
        // How far the aligned peak must stand above the room's background.
        threshold: ControlSpec(1, 20, \exp, 0, 4),
        // A band is lit within this fraction of the loudest: 0.2 is -14dB,
        // room enough for a phone speaker's uneven response across the sweep.
        lit: ControlSpec(0.05, 0.8, \exp, 0, 0.2),
        // Bands lit together, of eight, to count as the call.
        need: ControlSpec(3, 8, \lin, 1, 6),
        holdoff: ControlSpec(0.01, 0.5, \exp, 0, 0.05),
        // The quietest level that can count as anything: below it, silence.
        floor: ControlSpec(0.00001, 0.01, \exp, 0, 0.001)
    ),

    frozen: (
        out: 0
    ),

    supplied: (
        gate: 1,
        // The first hardware input is the mic; the page passes 0 to hear its
        // own output instead, for tests.
        in: 2
    )
))
