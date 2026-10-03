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

~sspEquals = { |name, actual, expected|
    ~sspCheck.(
        name,
        actual == expected,
        if (actual == expected) { "" } { "expected:" + expected.asCompileString + "got:" + actual.asCompileString }
    );
};

~sspFinish = {
    ("SSP_TEST_DONE" + ~sspPassed + "passed" + ~sspFailed + "failed").postln;
    if (~sspFailed > 0) { 1.exit } { 0.exit };
};
