var before = 0, after = 0, phase = \a;
var mkPattern = { |extra|
    Pbind(*([\instrument, \dcTest, \amp, 0, \dur, 0.1, \legato, 0.8, \freq, 220,
        \m, Pfunc { if (phase == \a) { before = before + 1 } { after = after + 1 }; 0 }] ++ extra))
};

Server.default.waitForBoot({
    SynthDef(\dcTest, { |out = 0, freq = 440, amp = 0.2, gate = 1|
        Out.ar(out, Pan2.ar(SinOsc.ar(freq)
            * EnvGen.kr(Env.adsr(0.01, 0.1, 0.7, 0.3), gate, doneAction: 2) * amp, 0));
    }).add;
    Server.default.sync;

    Routine({
        Pdef(\dc, mkPattern.value([])).play;
        1.5.wait;
        phase = \b;

        // Re-add the same name with an extra control, as a save would.
        SynthDef(\dcTest, { |out = 0, freq = 440, amp = 0.2, gate = 1, cutoff = 3000|
            Out.ar(out, Pan2.ar(LPF.ar(SinOsc.ar(freq), cutoff)
                * EnvGen.kr(Env.adsr(0.01, 0.1, 0.7, 0.3), gate, doneAction: 2) * amp, 0));
        }).add;
        Pdef(\dc, mkPattern.value([\cutoff, 3000]));

        1.5.wait;
        ("DC before=" ++ before ++ " after=" ++ after).postln;
        ("DC VERDICT=" ++ if (after > 5) { "KEEPS PLAYING" } { "STOPPED" }).postln;
        Server.default.freeAll;
        0.exit;
    }).play(TempoClock.default);
});
