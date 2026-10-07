// dulcimer1's `\dulcimerVerb`, ported with its own comments intact.
//
// The tail of the voice group. Voices play into a private bus rather than to the
// hardware, and this reads that bus and writes to the output — and because a
// Pbind's synths are added at the *head* of the group, every voice lands in
// front of this however many of them are sounding. Order is the whole mechanism.
//
// Gated rather than freed outright, so the group can be torn down without
// cutting a tail off mid-air.
//
// The reverb is commented out in the original, and it stays commented out here.
// That is a working note, not dead code — the long comment the original keeps
// above it describes what the line is for, and the choice to have it off is the
// author's. So this currently blocks DC and gates, and nothing else. Uncomment
// to hear what the structure was built for.
SynthDef(\ssp_dulcimer_fx, { |in = 0, out = 0, mix = 0.1, room = 1.12, damp = 0.2,
                             amp = 1, gate = 1, release = 1.4|
    var sig, env;

    sig = In.ar(in, 2);
    env = EnvGen.kr(Env.asr(0.01, 1, release), gate, doneAction: 2);

    // FreeVerb2 carries its own dry signal, so `mix` is the wet/dry blend and
    // nothing has to be routed around it.
    // sig = FreeVerb2.ar(sig[0], sig[1], mix, room, damp);

    sig = LeakDC.ar(sig);

    Out.ar(out, sig * env * amp);
},
metadata: (
    specs: (
        mix: ControlSpec(0, 1, \lin, 0, 0.1),
        room: ControlSpec(0, 2, \lin, 0, 1.12),
        damp: ControlSpec(0, 1, \lin, 0, 0.2),
        release: ControlSpec(0.05, 6, \exp, 0, 1.4),
        amp: \amp
    ),
    frozen: (),
    supplied: (in: 0, out: 0, gate: 1)
))
