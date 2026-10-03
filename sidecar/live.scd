// Authoring rig: play a SynthDef under a pattern, with GUI control of every
// parameter, and reload the def whenever its file is saved.
//
//   npm run sc:live ssp_sine
//
// The pattern keeps running across a reload. Saving the .scd re-sends the def
// to the server, so the next event uses the new sound while the one currently
// playing finishes on the old one — which is what makes it usable for tuning.
//
// It compiles against the same hermetic class path as `npm run sc:build`, so a
// def that works here is a def that will build. Inheriting the user's global
// config instead would let you author something that fails in CI.

var defName, srcPath, patternPath;
var here = PathName(thisProcess.nowExecutingPath).pathOnly;
var params, specs, controlNames;
var window, sliderBox, statusView;
var buildGui, loadDef, loadPattern, rebuild, specFor, watcher;
var defStamp = 0, patternStamp = 0;
var currentDef;

defName = thisProcess.argv[0] ? "ssp_sine";
srcPath = here +/+ "synthdefs" +/+ defName ++ ".scd";
patternPath = here +/+ "live_pattern.scd";

if (File.exists(srcPath).not) {
    ("SSP_LIVE no such SynthDef source:" + srcPath).postln;
    ("SSP_LIVE available:" + PathName(here +/+ "synthdefs").files
        .select { |p| p.extension == "scd" }
        .collect { |p| p.fileNameWithoutExtension }).postln;
    1.exit;
};

params = IdentityDictionary.new;
specs = IdentityDictionary.new;

// A slider needs a range, and a SynthDef only declares a default. Standard
// names have published specs; anything else gets a range inferred from its
// default, which is a guess but a usefully-shaped one.
specFor = { |name, default|
    var spec = name.asSpec;

    if (spec.isNil) {
        spec = case
        { name == \out } { ControlSpec(0, 16, \lin, 1, default) }
        { (default >= 0) and: { default <= 1 } } { ControlSpec(0, 1, \lin, 0, default) }
        { default == 0 } { ControlSpec(0, 1, \lin, 0, 0) }
        { ControlSpec(0, (default.abs * 4).max(1), \lin, 0, default) };
    };

    spec;
};

loadDef = {
    var def = thisProcess.interpreter.executeFile(srcPath);

    if (def.isKindOf(SynthDef).not) {
        ("SSP_LIVE" + srcPath.basename + "did not evaluate to a SynthDef").postln;
        nil;
    } {
        // .add both sends it to the server and updates SynthDescLib, so the
        // next event's \instrument lookup finds the new version.
        def.add;
        def;
    };
};

loadPattern = {
    if (File.exists(patternPath)) {
        thisProcess.interpreter.executeFile(patternPath);
    } {
        // A plain repeating note, so the rig is useful before anyone writes a
        // pattern for it.
        Pbind(\dur, 0.5);
    };
};

// Rebuild the event pattern from the GUI values plus whatever the pattern file
// contributes. Pattern keys come last so a sequenced key beats its slider.
rebuild = {
    var guiPairs = [], patternPairs = [], patternEvent;

    params.keysValuesDo { |key, value|
        guiPairs = guiPairs ++ [key, value];
    };

    patternEvent = loadPattern.value;
    patternPairs = if (patternEvent.isKindOf(Pbind)) { patternEvent.patternpairs } { [] };

    Pdef(\sspLive, Pbind(*([\instrument, currentDef.name] ++ guiPairs ++ patternPairs)));
};

buildGui = {
    var controls = SynthDescLib.global[currentDef.name].controls;

    controlNames = controls.collect { |c| c.name.asSymbol };

    sliderBox.children.copy.do { |child| child.remove };

    controls.do { |control|
        var name = control.name.asSymbol;
        var spec = specFor.(name, control.defaultValue);

        specs[name] = spec;
        params[name] = params[name] ? control.defaultValue;

        EZSlider(sliderBox, Rect(0, 0, 420, 24), name, spec, { |ez|
            params[name] = ez.value;
            rebuild.value;
        }, params[name], labelWidth: 110, numberWidth: 70);
    };

    window.refresh;
};

// sclang has no filesystem watcher, so poll. 250ms is imperceptible when you
// hit save and costs nothing between saves.
watcher = Routine({
    loop {
        var defNow = File.mtime(srcPath);
        var patternNow = if (File.exists(patternPath)) { File.mtime(patternPath) } { 0 };

        if (defNow != defStamp) {
            defStamp = defNow;
            {
                var reloaded = loadDef.value;
                if (reloaded.notNil) {
                    var before = controlNames;
                    currentDef = reloaded;

                    // Only rebuild the GUI when the control surface actually
                    // changed; otherwise the sliders would snap back to their
                    // defaults on every save and you would lose your tuning.
                    if (SynthDescLib.global[currentDef.name].controls
                        .collect { |c| c.name.asSymbol } != before) {
                        buildGui.value;
                        statusView.string = " reloaded — controls changed, sliders rebuilt";
                        "SSP_LIVE reloaded (controls changed)".postln;
                    } {
                        statusView.string = " reloaded " ++ Date.getDate.hourStamp;
                        "SSP_LIVE reloaded".postln;
                    };

                    rebuild.value;
                } {
                    statusView.string = " reload FAILED — see the post window";
                    "SSP_LIVE reload FAILED".postln;
                };
            }.defer;
        };

        if (patternNow != patternStamp) {
            patternStamp = patternNow;
            {
                rebuild.value;
                statusView.string = " pattern reloaded";
                "SSP_LIVE pattern reloaded".postln;
            }.defer;
        };

        0.25.wait;
    };
});

Server.default.waitForBoot({
    currentDef = loadDef.value;

    if (currentDef.isNil) {
        "SSP_LIVE could not load the SynthDef".postln;
        1.exit;
    };

    Server.default.sync;

    {
        window = Window("SS_Play — " ++ defName, Rect(120, 120, 460, 520))
            .onClose_({
                watcher.stop;
                Pdef(\sspLive).stop;
                Server.default.freeAll;
            });

        window.view.decorator = FlowLayout(window.view.bounds, 8@8, 4@4);

        Button(window, Rect(0, 0, 100, 26))
            .states_([["play", Color.black, Color.green(0.7)],
                      ["stop", Color.white, Color.red(0.6)]])
            .action_({ |b| if (b.value == 1) { Pdef(\sspLive).play } { Pdef(\sspLive).stop } });

        Button(window, Rect(0, 0, 100, 26))
            .states_([["reset sliders"]])
            .action_({ params.clear; buildGui.value; rebuild.value });

        statusView = StaticText(window, Rect(0, 0, 230, 26))
            .string_(" watching " ++ srcPath.basename);

        sliderBox = CompositeView(window, Rect(0, 0, 440, 440));
        sliderBox.decorator = FlowLayout(sliderBox.bounds, 0@0, 2@2);

        buildGui.value;
        rebuild.value;

        defStamp = File.mtime(srcPath);
        patternStamp = if (File.exists(patternPath)) { File.mtime(patternPath) } { 0 };
        watcher.play(AppClock);

        window.front;

        ("SSP_LIVE ready:" + defName + "— edit" + srcPath + "and save").postln;
    }.defer;
});
