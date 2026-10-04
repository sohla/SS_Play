var here = PathName(thisProcess.nowExecutingPath).pathOnly;
var def, countA = 0, countB = 0, phase = \a;

def = thisProcess.interpreter.executeFile(here +/+ "synthdefs/ssp_sine.scd");

Server.default.waitForBoot({
    def.add;
    Server.default.sync;

    Pdef(\rt, Pbind(
        \instrument, def.name,
        \amp, 0.0,                       // silent: this is a counting test
        \dur, 0.1,
        \freq, 220,
        \mark, Pfunc { if (phase == \a) { countA = countA + 1 } { countB = countB + 1 }; 0 }
    ));

    Routine({
        Pdef(\rt).play;
        1.5.wait;
        ("RT phase-a events=" ++ countA).postln;
        ("RT isPlaying-before=" ++ Pdef(\rt).isPlaying).postln;

        phase = \b;
        // Exactly what the rig does on save: re-add the def, then redefine.
        def.add;
        Pdef(\rt, Pbind(
            \instrument, def.name,
            \amp, 0.0,
            \dur, 0.1,
            \freq, 330,
            \mark, Pfunc { if (phase == \a) { countA = countA + 1 } { countB = countB + 1 }; 0 }
        ));

        1.5.wait;
        ("RT phase-b events=" ++ countB).postln;
        ("RT isPlaying-after=" ++ Pdef(\rt).isPlaying).postln;
        ("RT VERDICT=" ++ if (countB > 5) { "KEEPS PLAYING" } { "STOPPED" }).postln;
        0.exit;
    }).play(TempoClock.default);
});
