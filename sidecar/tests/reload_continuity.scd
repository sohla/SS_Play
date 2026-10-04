// The live rig's core promise: saving a SynthDef must not stop the pattern.
//
// Needs a booted server, so it is not part of sc:test. Silent by design —
// amp 0 — because a test suite should not make noise.

var here = PathName(thisProcess.nowExecutingPath).pathOnly.dirname;
var def, before = 0, after = 0, reloaded = false;

thisProcess.interpreter.executeFile(here +/+ "lib/ssp_assert.scd");
def = thisProcess.interpreter.executeFile(here +/+ "synthdefs/ssp_sine.scd");

Server.default.waitForBoot({
    var makePattern = {
        Pbind(
            \instrument, def.name,
            \amp, 0,
            \dur, 0.1,
            \legato, 0.8,
            \freq, 220,
            \sspCount, Pfunc { if (reloaded) { after = after + 1 } { before = before + 1 }; 0 }
        )
    };

    def.add;
    Server.default.sync;

    Routine({
        Pdef(\sspContinuity, makePattern.value).play;
        1.5.wait;

        ~sspCheck.("continuity/plays-before", before > 5,
            "the pattern produced only" + before + "events before the reload");

        // Exactly what the watcher does on save.
        reloaded = true;
        def = thisProcess.interpreter.executeFile(here +/+ "synthdefs/ssp_sine.scd");
        def.add;
        Pdef(\sspContinuity, makePattern.value);

        1.5.wait;

        ~sspCheck.("continuity/survives-reload", after > 5,
            "the pattern produced only" + after + "events after the reload — saving stopped it");
        ~sspCheck.("continuity/still-playing", Pdef(\sspContinuity).isPlaying,
            "the Pdef stopped");

        Pdef(\sspContinuity).stop;
        Server.default.freeAll;
        ~sspFinish.();
    }).play(TempoClock.default);
});
