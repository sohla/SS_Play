// Reading and validating the parameter contract carried in SynthDef metadata.
//
// Shared by the build, the assertions and the live rig so all three agree about
// what a def promises. Loaded with executeFile, like ssp_assert.scd.

// Resolve a spec entry to a ControlSpec. Entries may be a ControlSpec, a bare
// symbol naming one of SuperCollider's built-ins, or an array in ControlSpec
// argument order — so the built-in table is never transcribed by hand.
~sspResolveSpec = { |entry|
    case
    { entry.isKindOf(ControlSpec) } { entry }
    { entry.isKindOf(Symbol) } { entry.asSpec }
    { entry.isKindOf(Array) } { ControlSpec(*entry) }
    { nil };
};

~sspMetadata = { |desc|
    desc.metadata ? ();
};

~sspCategory = { |desc, which|
    (~sspMetadata.(desc)[which] ? ()) ;
};

// Every argument must appear in exactly one category. Returns a dictionary of
// problems rather than posting, so callers decide how loud to be.
~sspContractProblems = { |desc|
    var controls = desc.controlNames.collect(_.asSymbol);
    var specs = ~sspCategory.(desc, \specs);
    var frozen = ~sspCategory.(desc, \frozen);
    var supplied = ~sspCategory.(desc, \supplied);
    var declared = IdentityDictionary.new;
    var unlisted, unknown, overlapping, unresolvable, unencodable;

    [[\specs, specs], [\frozen, frozen], [\supplied, supplied]].do { |pair|
        pair[1].keysDo { |key|
            declared[key] = (declared[key] ? []) ++ [pair[0]];
        };
    };

    // An argument the metadata never mentions. The live rig would show no
    // control for it and the pattern would not set it, so it silently sits at
    // whatever the SynthDef declared.
    unlisted = controls.select { |name| declared[name].isNil };

    // Metadata naming an argument the SynthDef does not have — usually a
    // rename where only one side was updated.
    unknown = declared.keys.asArray.select { |name| controls.includes(name).not };

    // Two categories disagreeing about the same argument.
    overlapping = declared.keys.asArray.select { |name| declared[name].size > 1 };

    // A spec entry that is not a ControlSpec, a known symbol, or an array.
    unresolvable = specs.keys.asArray.select { |name|
        ~sspResolveSpec.(specs[name]).isNil
    };

    // A resolvable spec whose bounds cannot be written to JSON, so no page
    // could ever draw it. \db is the one that bites: its minval is -inf.
    unencodable = specs.keys.asArray.select { |name|
        var spec = ~sspResolveSpec.(specs[name]);
        spec.notNil and: {
            [spec.minval, spec.maxval, spec.step].any { |value|
                value.isNumber.not or: { value.isNaN or: { value.abs == inf } }
            }
        }
    };

    (
        unlisted: unlisted.asArray.sort,
        unknown: unknown.sort,
        overlapping: overlapping.sort,
        unresolvable: unresolvable.sort,
        unencodable: unencodable.sort
    );
};

// Flatten the contract into something a JSON encoder can take, with every spec
// resolved to numbers. The browser reads this and never needs SuperCollider's
// spec table.
~sspContractJson = { |desc|
    var specs = ~sspCategory.(desc, \specs);
    var frozen = ~sspCategory.(desc, \frozen);
    var supplied = ~sspCategory.(desc, \supplied);
    var defaults = IdentityDictionary.new;
    var out = ();

    desc.controls.do { |control| defaults[control.name.asSymbol] = control.defaultValue };

    out[\specs] = specs.keys.asArray.sort.collect { |name|
        var spec = ~sspResolveSpec.(specs[name]);
        (
            name: name.asString,
            min: spec.minval,
            max: spec.maxval,
            // A symbol for the named curves, a number for a curve value.
            warp: if (spec.warp.isKindOf(CurveWarp)) { spec.warp.curve } { spec.warp.asSpecifier.asString },
            step: spec.step,
            default: defaults[name] ? spec.default,
            units: spec.units.asString
        )
    };

    out[\frozen] = frozen.keys.asArray.sort.collect { |name|
        (name: name.asString, value: frozen[name])
    };

    out[\supplied] = supplied.keys.asArray.sort.collect { |name|
        (name: name.asString, default: defaults[name] ? supplied[name])
    };

    out;
};

// A minimal JSON encoder.
//
// The hermetic class path deliberately excludes quarks, so JSONlib is not
// available — and adding it back for this would undo the isolation the build
// depends on. Only numbers, strings, arrays and dictionaries occur here.
//
// Keys are emitted in sorted order so the output is byte-stable, which is what
// lets the promotion gate diff it.
~sspToJson = { |value, indent = 0|
    var pad = String.fill(indent * 2, $ );
    var padIn = String.fill((indent + 1) * 2, $ );
    var escape, keys;

    escape = { |string|
        string.asString
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\t", "\\t")
    };

    case
    { value.isNil } { "null" }
    { value === true } { "true" }
    { value === false } { "false" }
    { value.isNumber } {
        // inf and nan have no JSON representation, and emitting them silently
        // produces a file no parser will read.
        if (value.isNaN or: { value.isKindOf(Float) and: { value.abs == inf } }) {
            Error("Cannot encode" + value + "as JSON").throw;
        };
        if (value.asInteger == value) { value.asInteger.asString } { value.asString };
    }
    { value.isKindOf(String) or: { value.isKindOf(Symbol) } } {
        "\"" ++ escape.(value) ++ "\""
    }
    { value.isKindOf(SequenceableCollection) } {
        if (value.isEmpty) { "[]" } {
            "[\n" ++ value.collect { |item| padIn ++ ~sspToJson.(item, indent + 1) }.join(",\n")
                ++ "\n" ++ pad ++ "]"
        }
    }
    { value.isKindOf(Dictionary) } {
        keys = value.keys.asArray.collect(_.asString).sort;
        if (keys.isEmpty) { "{}" } {
            "{\n" ++ keys.collect { |key|
                padIn ++ "\"" ++ escape.(key) ++ "\": "
                    ++ ~sspToJson.(value[key.asSymbol], indent + 1)
            }.join(",\n") ++ "\n" ++ pad ++ "}"
        }
    }
    { Error("Cannot encode" + value.class + "as JSON").throw };
};
