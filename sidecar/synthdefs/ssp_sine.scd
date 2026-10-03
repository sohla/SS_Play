// A plain self-freeing sine. Deliberately simple: the e2e audio assertions use
// it as the known-good signal, so its spectrum has to be unambiguous.
//
// The metadata block is the parameter contract, following the convention in
// TTSD and SCAestheticRanking. Three categories, and every argument is in
// exactly one of them — `sc:test` fails if an argument is in none or in two:
//
//   specs     has a range, and gets a slider in the live rig
//   frozen    pinned; no slider
//   supplied  provided per event by the pattern, so neither
//
// Bare symbols like \amp are resolved by SuperCollider's own spec table, so the
// built-in ranges are never transcribed by hand into TypeScript.
SynthDef(\ssp_sine, { |out = 0, freq = 440, amp = 0.2, pan = 0,
                      attack = 0.01, sustain = 0.5, release = 0.1|
    var env = EnvGen.kr(Env.linen(attack, sustain, release), doneAction: 2);
    Out.ar(out, Pan2.ar(SinOsc.ar(freq) * env * amp, pan));
},
metadata: (
    specs: (
        amp: \amp,
        pan: \pan,

        // Envelope segments in seconds. Capped at 2s rather than \duration's
        // 0.01-10: a test tone that can run for ten seconds would make the
        // capture-based audio assertions wait on it.
        attack: ControlSpec(0.001, 2, \exp, 0, 0.01),
        sustain: ControlSpec(0.01, 2, \exp, 0, 0.5),
        release: ControlSpec(0.001, 2, \exp, 0, 0.1)
    ),

    frozen: (
        out: 0
    ),

    // The pattern sequences pitch, so a freq slider would fight it and appear
    // broken. See sidecar/live_pattern.scd.
    supplied: (
        freq: 440
    )
))
