// Assert each compiled def against its descriptor.
//
// Runs language-side only: SynthDef(...).add registers into SynthDescLib
// without a server, so none of this needs scsynth booted. What it cannot see is
// whether the def makes sound in the browser — that is the e2e suite's job.

var outDir = thisProcess.argv[0];
var here = PathName(thisProcess.nowExecutingPath).pathOnly;
var sources, contracts;

thisProcess.interpreter.executeFile(here +/+ "lib/ssp_assert.scd");
contracts = thisProcess.interpreter.executeFile(here +/+ "tests/contracts.scd");

sources = PathName(here +/+ "synthdefs").files.select { |p| p.extension == "scd" }.sort { |a, b|
    a.fileName < b.fileName
};

sources.do { |path|
    var def = thisProcess.interpreter.executeFile(path.fullPath);
    var name = def.name.asString;
    var desc, file;

    def.add;
    desc = SynthDescLib.global[def.name];

    ~sspCheck.(name ++ "/descriptor", desc.notNil, "SynthDescLib has no entry");

    if (desc.notNil) {
        // A def that never frees its node is the most common SynthDef bug, and
        // in the browser it surfaces as maxNodes exhaustion thirty seconds in
        // rather than as an error. Catch it at authoring time.
        ~sspCheck.(name ++ "/frees-itself", desc.canFreeSynth,
            "no doneAction will ever free this node");

        // controlNames is an Array of Symbols, not Strings.
        ~sspCheck.(name ++ "/has-out", desc.controlNames.includes(\out), "no out control");
        ~sspCheck.(name ++ "/has-amp", desc.controlNames.includes(\amp), "no amp control");

        // The full ordered contract, so a reorder cannot pass unnoticed.
        if (contracts[def.name].notNil) {
            ~sspEquals.(name ++ "/controls", desc.controlNames, contracts[def.name]);
        } {
            ~sspCheck.(name ++ "/contract", false,
                "no entry in tests/contracts.scd for" + def.name);
        };

        ~sspCheck.(name ++ "/stereo", desc.outputs.sum { |o| o.numberOfChannels } == 2,
            "expected 2 output channels, got" + desc.outputs.sum { |o| o.numberOfChannels });

        ~sspCheck.(name ++ "/no-infs",
            desc.controls.every { |c| c.defaultValue.isNumber and: { c.defaultValue.isNaN.not } },
            "a control default is not a finite number");
    };

    file = outDir +/+ name ++ ".scsyndef";
    ~sspCheck.(name ++ "/written", File.exists(file), file);
};

// Negative control: prove the frees-itself check can actually fail, so a green
// run means the assertion works rather than that it never fires.
//
// Written as a function because `var` inside a parenthesised block is a parse
// error that stops the whole file executing *silently* — no message, sclang
// just sits at its REPL. A function body may declare vars.
{
    var leaky = SynthDef(\ssp__leaky_fixture, { |out = 0|
        Out.ar(out, SinOsc.ar(440) * 0.1);
    });
    leaky.add;
    ~sspCheck.("fixture/detects-a-leak",
        SynthDescLib.global[\ssp__leaky_fixture].canFreeSynth.not,
        "a def with no doneAction was reported as self-freeing");
}.value;

~sspFinish.();
