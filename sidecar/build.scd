// Compile every synthdefs/*.scd into out/<name>.scsyndef.
//
// Each source file is an expression that evaluates to a SynthDef, so the build
// needs no registration convention and a source file stays independently
// loadable in the IDE.

var outDir = thisProcess.argv[0];
var here = PathName(thisProcess.nowExecutingPath).pathOnly;
var srcDir = here +/+ "synthdefs";
var sources, written = 0;

thisProcess.interpreter.executeFile(here +/+ "lib/ssp_contract.scd");

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

    // The contract has to be emitted separately: writeDefFile puts metadata in
    // a .txarcmeta sidecar, which is a SuperCollider archive no web build can
    // read. Resolving the specs to numbers here means the browser never needs
    // SuperCollider's spec table either.
    {
        var desc, problems, file;
        def.add;
        desc = SynthDescLib.global[def.name];
        problems = ~sspContractProblems.(desc);

        if (problems.values.any { |list| list.notEmpty }) {
            ("SSP_BUILD FAIL" + def.name + "parameter contract:"
                + problems.asCompileString).postln;
            1.exit;
        };

        file = File(outDir +/+ def.name ++ ".contract.json", "w");
        file.write(~sspToJson.(~sspContractJson.(desc)) ++ "\n");
        file.close;
    }.value;

    written = written + 1;
    ("SSP_BUILD wrote" + def.name ++ ".scsyndef + .contract.json").postln;
};

("SSP_BUILD_DONE" + written + "of" + sources.size).postln;
0.exit;
