// Assert each compiled def against its descriptor.
//
// Runs language-side only: SynthDef(...).add registers into SynthDescLib
// without a server, so none of this needs scsynth booted. What it cannot see is
// whether the def makes sound in the browser — that is the e2e suite's job.

var outDir = thisProcess.argv[0];
var here = PathName(thisProcess.nowExecutingPath).pathOnly;
var sources;

thisProcess.interpreter.executeFile(here +/+ "lib/ssp_assert.scd");
thisProcess.interpreter.executeFile(here +/+ "lib/ssp_contract.scd");

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

        // The parameter contract: every argument in exactly one category, and
        // every spec resolvable to a real range. Without this a control can be
        // added to the graph and silently reach no UI and no pattern.
        {
            var problems = ~sspContractProblems.(desc);
            ~sspCheck.(name ++ "/contract-complete", problems[\unlisted].isEmpty,
                "arguments in no category:" + problems[\unlisted]);
            ~sspCheck.(name ++ "/contract-known", problems[\unknown].isEmpty,
                "metadata names arguments the def does not declare:" + problems[\unknown]);
            ~sspCheck.(name ++ "/contract-exclusive", problems[\overlapping].isEmpty,
                "arguments in more than one category:" + problems[\overlapping]);
            ~sspCheck.(name ++ "/contract-resolvable", problems[\unresolvable].isEmpty,
                "specs that resolve to no range:" + problems[\unresolvable]);
            ~sspCheck.(name ++ "/contract-encodable", problems[\unencodable].isEmpty,
                "specs with bounds that cannot be written to JSON:" + problems[\unencodable]);
        }.value;

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

// The live authoring rig depends on live_pattern.scd being a usable event
// pattern, and on GUI values being overridable by sequenced keys. Both break
// silently — the rig just plays the wrong thing — so assert them here.
{
    var pattern = thisProcess.interpreter.executeFile(here +/+ "live_pattern.scd");
    var def = thisProcess.interpreter.executeFile(here +/+ "synthdefs/ssp_sine.scd");
    var merged, event;

    ~sspCheck.("live/pattern-is-a-pbind", pattern.isKindOf(Pbind),
        "live_pattern.scd must evaluate to a Pbind");

    if (pattern.isKindOf(Pbind)) {
        def.add;

        // Same construction the rig uses: GUI values first, pattern keys last.
        merged = Pbind(*([\instrument, def.name, \amp, 0.9, \dur, 99]
            ++ pattern.patternpairs));
        event = merged.asStream.next(Event.default);

        ~sspCheck.("live/yields-events", event.notNil, "pattern produced no event");

        if (event.notNil) {
            ~sspEquals.("live/instrument", event[\instrument], def.name);

            // dur is sequenced by the pattern, so it must win over the 99 above.
            ~sspCheck.("live/pattern-overrides-gui", event[\dur] != 99,
                "a sequenced key did not override its GUI value");

            // amp is not in the pattern, so the GUI value must survive.
            ~sspEquals.("live/gui-value-survives", event[\amp], 0.9);
        };
    };
}.value;

// Negative fixtures: prove each contract check can actually fail. Without
// these a green run could mean the validator never fires.
{
    var fixtures = [
        [\unlisted, "bad_unlisted.scd", "an argument in no category"],
        [\overlapping, "bad_overlap.scd", "an argument in two categories"],
        [\unknown, "bad_unknown.scd", "metadata naming an argument that does not exist"],
        [\unresolvable, "bad_unresolvable.scd", "a spec that resolves to no range"],
        [\unencodable, "bad_unencodable.scd", "a spec whose bounds cannot be encoded"]
    ];

    fixtures.do { |entry|
        var key = entry[0], file = entry[1], description = entry[2];
        var def = thisProcess.interpreter.executeFile(here +/+ "tests/fixtures" +/+ file);
        var problems;
        def.add;
        problems = ~sspContractProblems.(SynthDescLib.global[def.name]);

        ~sspCheck.("fixture/detects-" ++ key, problems[key].notEmpty,
            description + "was not detected");
    };
}.value;

~sspFinish.();
