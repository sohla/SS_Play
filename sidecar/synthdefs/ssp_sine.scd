// A plain gated sine. Deliberately simple: the e2e audio assertions use it as
// the known-good signal, so its spectrum has to be unambiguous.
//
// Two naming decisions that are not cosmetic:
//
//   gate      Without one, the event system never releases a note — `sendGate`
//             is gated on `desc.hasGate` — so \legato and \sustain do nothing
//             and a note ends only when its own envelope runs out. You also
//             cannot hold a drone while tuning, which is most of the point of
//             the live rig.
//
//   susLevel  Not `sustain`. The event system computes `sustain` as a *time*
//             (dur * legato * stretch) and sends it to any argument of that
//             name, so a `sustain` argument silently receives a note length
//             rather than whatever it was meant to mean.
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
SynthDef(\ssp_sine, { |out = 0, freq = 440, amp = 0.2, pan = 0, gate = 1,
                      attack = 0.01, decay = 0.1, susLevel = 0.7, release = 0.3|
    var env = EnvGen.kr(Env.adsr(attack, decay, susLevel, release), gate, doneAction: 2);
    Out.ar(out, Pan2.ar(SinOsc.ar(freq) * env * amp, pan));
},
metadata: (
    specs: (
        amp: \amp,
        pan: \pan,

        // Seconds. Capped at 2 rather than \duration's 0.01-10: a test tone
        // that can run for ten seconds would make the capture-based audio
        // assertions wait on it.
        attack: ControlSpec(0.001, 2, \exp, 0, 0.01),
        decay: ControlSpec(0.001, 2, \exp, 0, 0.1),
        release: ControlSpec(0.001, 2, \exp, 0, 0.3),

        // A level, not a time.
        susLevel: \unipolar
    ),

    frozen: (
        out: 0
    ),

    // Both come from the event: the pattern sequences pitch, and the event
    // system opens and closes the gate around each note.
    supplied: (
        freq: 440,
        gate: 1
    )
))
