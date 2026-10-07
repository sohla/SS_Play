// Assertion helpers, kept in ~environment variables rather than a class.
//
// A class would have to be installed into the user's SuperCollider Extensions
// directory to compile at all, which this project has no business writing to —
// and which would defeat the hermetic class path the build depends on. That is
// also why this is not UnitTest.
//
// Each check prints one SSP_TEST line; bin/sc.mjs parses them and sets the
// exit code.

~sspPassed = 0;
~sspFailed = 0;
~sspWaived = 0;

// `detail` describes what went wrong, so it is printed only when something did.
~sspCheck = { |name, ok, detail = ""|
    if (ok) {
        ~sspPassed = ~sspPassed + 1;
        ("SSP_TEST pass" + name).postln;
    } {
        ~sspFailed = ~sspFailed + 1;
        ("SSP_TEST FAIL" + name + "--" + detail).postln;
    };
};

// A check a def declares it does not have to pass, with the reason why.
//
// Some of these rules protect against sclang's event system — `sustain` being
// overwritten with a computed time, a note that cannot be released without a
// gate — and a def authored for the JS conductor is not reached by any of it.
// The rule is still worth keeping for everything else, so the exception is
// declared at the def rather than removed from the suite.
//
// A waiver with no reason is itself a failure. The point is that someone had to
// write down why, and that it shows up in the output rather than being absent
// from it.
~sspWaiver = { |def, check|
    var waives = def.metadata.tryPerform(\at, \waives);
    if (waives.isNil) { nil } { waives[check.asSymbol] };
};

// Like ~sspCheck, but consults the def's waivers first.
~sspCheckWaivable = { |def, name, check, ok, detail = ""|
    var reason = ~sspWaiver.(def, check);
    case
        { ok } {
            ~sspPassed = ~sspPassed + 1;
            ("SSP_TEST pass" + name).postln;
            // A waiver for something that passes is stale and says the def
            // changed without the note being revisited.
            if (reason.notNil) {
                ~sspFailed = ~sspFailed + 1;
                ("SSP_TEST FAIL" + name + "-- waived but passing; remove the waiver").postln;
            };
        }
        { reason.isNil } {
            ~sspFailed = ~sspFailed + 1;
            ("SSP_TEST FAIL" + name + "--" + detail).postln;
        }
        { reason.asString.size < 20 } {
            ~sspFailed = ~sspFailed + 1;
            ("SSP_TEST FAIL" + name + "-- waiver needs a reason, got:" + reason).postln;
        }
        { true } {
            ~sspWaived = ~sspWaived + 1;
            ("SSP_TEST waived" + name + "--" + reason).postln;
        };
};

~sspEquals = { |name, actual, expected|
    ~sspCheck.(
        name,
        actual == expected,
        if (actual == expected) { "" } { "expected:" + expected.asCompileString + "got:" + actual.asCompileString }
    );
};

~sspFinish = {
    if (~sspWaived > 0) {
        ("SSP_TEST_WAIVED" + ~sspWaived).postln;
    };
    ("SSP_TEST_DONE" + ~sspPassed + "passed" + ~sspFailed + "failed").postln;
    if (~sspFailed > 0) { 1.exit } { 0.exit };
};
