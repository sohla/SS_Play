// The live rig's core promise: saving a SynthDef must not stop the pattern.
//
// Counts events in process rather than by reading the log. Counting postln
// lines by position is unreliable — flushing does not preserve ordering against
// other output, which produced a convincing false "it stopped" more than once.
//
// Needs a booted server, so it is not part of sc:test. Silent by design: amp 0.

var here = PathName(thisProcess.nowExecutingPath).pathOnly.dirname;
var counts = IdentityDictionary[\a -> 0, \b -> 0, \c -> 0];
var phase = \a;
var makePattern, def;

thisProcess.interpreter.executeFile(here +/+ "lib/ssp_assert.scd");

makePattern = { |extra = #[]|
    Pbind(*([
        \instrument, \ssp__continuity,
        \amp, 0,
        \dur, 0.1,
        \legato, 0.8,
        \freq, 220,
        \sspCount, Pfunc { counts[phase] = counts[phase] + 1; 0 }
    ] ++ extra))
};

// v1 and v2 differ in their control surface: v2 adds `cutoff`. Rebuilding the
// panel for that is the case that actually exercises the rig's reload path.
~sspV1 = {
    SynthDef(\ssp__continuity, { |out = 0, freq = 440, amp = 0.2, gate = 1|
        Out.ar(out, Pan2.ar(SinOsc.ar(freq)
            * EnvGen.kr(Env.adsr(0.01, 0.1, 0.7, 0.3), gate, doneAction: 2) * amp, 0));
    })
};

~sspV2 = {
    SynthDef(\ssp__continuity, { |out = 0, freq = 440, amp = 0.2, gate = 1, cutoff = 3000|
        Out.ar(out, Pan2.ar(LPF.ar(SinOsc.ar(freq), cutoff)
            * EnvGen.kr(Env.adsr(0.01, 0.1, 0.7, 0.3), gate, doneAction: 2) * amp, 0));
    })
};

Server.default.waitForBoot({
    def = ~sspV1.value;
    def.add;
    Server.default.sync;

    Routine({
        Pdef(\sspContinuity, makePattern.value).play;
        1.5.wait;

        ~sspCheck.("continuity/plays-before", counts[\a] > 5,
            "only" + counts[\a] + "events before any reload");

        // A save that changes nothing about the control surface.
        phase = \b;
        def = ~sspV1.value;
        def.add;
        Pdef(\sspContinuity, makePattern.value);
        1.5.wait;

        ~sspCheck.("continuity/survives-plain-save", counts[\b] > 5,
            "only" + counts[\b] + "events after an unchanged reload — saving stopped it");

        // A save that adds a control, which rebuilds the whole panel.
        phase = \c;
        def = ~sspV2.value;
        def.add;
        Pdef(\sspContinuity, makePattern.value([\cutoff, 3000]));
        1.5.wait;

        ~sspCheck.("continuity/survives-added-control", counts[\c] > 5,
            "only" + counts[\c] + "events after adding a control — saving stopped it");
        ~sspCheck.("continuity/still-playing", Pdef(\sspContinuity).isPlaying,
            "the Pdef stopped");
        ~sspCheck.("continuity/new-control-visible",
            SynthDescLib.global[\ssp__continuity].controlNames.includes(\cutoff),
            "the added control never reached SynthDescLib, so no UI could show it");

        Pdef(\sspContinuity).stop;
        Server.default.freeAll;
        ~sspFinish.();
    }).play(TempoClock.default);
});
