// The reverb the drops play into. Ported from airkit's `droplet.sc`, where it
// had already been lifted off the individual drops onto one synth at the tail
// of the group — the right shape, and the reason this ports cleanly.
//
// Lives after the drops in the node order so it hears them.
SynthDef(\ssp_drop_verb, { |in = 0, out = 0, mix = 0.2, room = 0.83, damp = 0.5,
                           amp = 1, gate = 1, release = 0.5|
    var sig, env;

    sig = In.ar(in, 2);
    env = EnvGen.kr(Env.asr(0.01, 1, release), gate, doneAction: 2);

    // room is clipped, as in the original: a persistent reverb fed a room above
    // 1 does not decay, it grows — and the phone is driving this control.
    sig = FreeVerb2.ar(sig[0], sig[1], mix, room.clip(0, 0.95), damp);
    sig = LeakDC.ar(sig);

    Out.ar(out, sig * env * amp);
},
metadata: (
    specs: (
        mix: \unipolar,
        // Stops short of 0.95 because that is where the clip in the graph is,
        // and a slider whose top third does nothing is a broken control.
        room: ControlSpec(0.2, 0.94, \lin, 0, 0.83),
        damp: \unipolar,
        amp: \amp,
        release: ControlSpec(0.05, 4, \exp, 0, 0.5)
    ),

    frozen: (
        out: 0
    ),

    supplied: (
        in: 0,
        gate: 1
    )
))
