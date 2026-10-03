// Compile every synthdefs/*.scd into out/<name>.scsyndef.
//
// Each source file is an expression that evaluates to a SynthDef, so the build
// needs no registration convention and a source file stays independently
// loadable in the IDE.

var outDir = thisProcess.argv[0];
var srcDir = PathName(thisProcess.nowExecutingPath).pathOnly +/+ "synthdefs";
var sources, written = 0;

sources = PathName(srcDir).files.select { |p| p.extension == "scd" }.sort { |a, b|
    a.fileName < b.fileName
};

if (sources.isEmpty) {
    "SSP_BUILD no sources found".postln;
    1.exit;
};

sources.do { |path|
    var def = thisProcess.interpreter.executeFile(path.fullPath);

    if (def.isKindOf(SynthDef).not) {
        ("SSP_BUILD FAIL" + path.fileName + "did not evaluate to a SynthDef").postln;
        1.exit;
    };

    if (def.name.asString.beginsWith("ssp_").not) {
        // Authored defs are namespaced so they can never collide with the 131
        // sonic-pi-* defs vendored from the synthdefs package.
        ("SSP_BUILD FAIL" + path.fileName + "name" + def.name + "must start with ssp_").postln;
        1.exit;
    };

    def.writeDefFile(outDir);
    written = written + 1;
    ("SSP_BUILD wrote" + def.name ++ ".scsyndef").postln;
};

("SSP_BUILD_DONE" + written + "of" + sources.size).postln;
0.exit;
