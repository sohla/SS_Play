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

var defName, srcPath, patternPath, autoPlay;
var here = PathName(thisProcess.nowExecutingPath).pathOnly;
var contract;
var params, specs, sliders, controlNames;
var window, sliderBox, statusView, playButton;
var buildGui, loadDef, loadPattern, rebuild, specFor, watcher;
var defStamp = 0, patternStamp = 0;
var currentDef;

defName = thisProcess.argv[0] ? "ssp_sine";
autoPlay = (thisProcess.argv[1] ? "") == "play";
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
sliders = IdentityDictionary.new;

// Ranges come from the def's own metadata, never from a guess. A control the
// contract does not put in `specs` gets no slider: `frozen` is pinned and
// `supplied` belongs to the pattern, and a slider for either would look broken.
specFor = { |desc, name|
    ~sspResolveSpec.(~sspCategory.(desc, \specs)[name]);
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
    var desc = SynthDescLib.global[currentDef.name];
    var defaults = IdentityDictionary.new;
    var specNames, frozen, supplied;

    desc.controls.do { |c| defaults[c.name.asSymbol] = c.defaultValue };

    specNames = ~sspCategory.(desc, \specs).keys.asArray.sort;
    frozen = ~sspCategory.(desc, \frozen);
    supplied = ~sspCategory.(desc, \supplied);

    controlNames = desc.controlNames.collect(_.asSymbol);

    // Tear the panel down and rebuild it on every reload. Trying to detect
    // whether the control surface changed was both wrong and unnecessary: the
    // values that matter are carried in `params`, not in the widgets.
    sliderBox.children.copy.do { |child| child.remove };

    // FlowLayout.remove is a no-op — removing a view does not give its space
    // back — so without this every rebuild starts lower than the last and the
    // panel walks off the bottom of the window.
    // FlowLayout.remove is a no-op — removing a view does not give its space
    // back — so without this every rebuild starts lower than the last. Measured:
    // the panel walked 0 -> 216 -> 432 across three saves, which put a newly
    // added control off the bottom of the window entirely.
    sliderBox.decorator.reset;
    sliders.clear;

    // Drop values for arguments the def no longer declares, so a renamed
    // control does not keep being sent to a synth that has never heard of it.
    params.keys.asArray.do { |name|
        if (controlNames.includes(name).not) { params.removeAt(name) };
    };

    specNames.do { |name|
        var spec = specFor.(desc, name);

        specs[name] = spec;
        params[name] = params[name] ? defaults[name] ? spec.default;

        sliders[name] = EZSlider(sliderBox, Rect(0, 0, 420, 24), name, spec, { |ez|
            params[name] = ez.value;
            rebuild.value;
        }, params[name], labelWidth: 110, numberWidth: 70);
    };

    // Frozen values are still sent — they are pinned, not absent — but shown as
    // text so it is obvious why there is no slider for them.
    frozen.keysValuesDo { |name, value|
        params[name] = value;
        StaticText(sliderBox, Rect(0, 0, 420, 18))
            .string_(" " ++ name ++ "  " ++ value ++ "   (frozen)")
            .stringColor_(Color.gray(0.55));
    };

    supplied.keysDo { |name|
        // Dropped from params entirely: the pattern supplies it per event, and
        // a GUI value here would be overridden on every note anyway.
        params.removeAt(name);
        StaticText(sliderBox, Rect(0, 0, 420, 18))
            .string_(" " ++ name ++ "   (supplied by the pattern)")
            .stringColor_(Color.gray(0.55));
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
                    var added;
                    var before = controlNames;
                    currentDef = reloaded;

                    // Always rebuild. The pattern is unaffected — it lives in
                    // the Pdef, not the window — so the server keeps playing
                    // while the panel is replaced, and slider positions survive
                    // because they are read back out of `params`.
                    buildGui.value;

                    added = controlNames.difference(before);
                    statusView.string = if (added.isEmpty) {
                        " reloaded " ++ Date.getDate.hourStamp
                    } {
                        " reloaded — new: " ++ added.join(", ")
                    };
                    ("SSP_LIVE reloaded"
                        ++ if (added.isEmpty) { "" } { " (new controls: " ++ added.join(", ") ++ ")" }
                    ).postln;

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

thisProcess.interpreter.executeFile(here +/+ "lib/ssp_contract.scd");

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

        playButton = Button(window, Rect(0, 0, 100, 26))
            .states_([["play", Color.black, Color.green(0.7)],
                      ["stop", Color.white, Color.red(0.6)]])
            .action_({ |b| if (b.value == 1) { Pdef(\sspLive).play } { Pdef(\sspLive).stop } });

        if (autoPlay) { playButton.valueAction_(1) };

        Button(window, Rect(0, 0, 100, 26))
            .states_([["reset"]])
            .action_({
                // Move the existing sliders rather than tearing the panel down
                // and building it again: a redraw makes the whole window flash
                // and loses scroll position for no benefit.
                var desc = SynthDescLib.global[currentDef.name];
                var defaults = IdentityDictionary.new;
                desc.controls.do { |c| defaults[c.name.asSymbol] = c.defaultValue };

                sliders.keysValuesDo { |name, ez|
                    var value = defaults[name] ? specs[name].default;
                    params[name] = value;
                    // value_ rather than valueAction_: setting them one by one
                    // would rebuild the pattern once per slider.
                    ez.value_(value);
                };

                rebuild.value;
            });

        statusView = StaticText(window, Rect(0, 0, 230, 26))
            .string_(" watching " ++ srcPath.basename);

        // A ScrollView, not a plain CompositeView: a def with twenty controls
        // would otherwise run off the bottom with no way to reach them. The
        // decorator's bounds are deliberately taller than the view so content
        // flows past the fold and the scroller has something to scroll.
        sliderBox = ScrollView(window, Rect(0, 0, 440, 440))
            .hasHorizontalScroller_(false)
            .autohidesScrollers_(true);
        sliderBox.decorator = FlowLayout(Rect(0, 0, 424, 4000), 0@0, 2@2);

        buildGui.value;
        rebuild.value;

        defStamp = File.mtime(srcPath);
        patternStamp = if (File.exists(patternPath)) { File.mtime(patternPath) } { 0 };
        watcher.play(AppClock);

        window.front;

        ("SSP_LIVE ready:" + defName + "— edit" + srcPath + "and save").postln;
    }.defer;
});
