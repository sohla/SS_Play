// The microphone's onsets: when a sound starts, how loud it got, and its pitch.
//
// Silent, like the followers. It reads the first hardware input and reports
// each onset once, `window` seconds after it starts, so the peak and the pitch
// it carries are of the sound itself rather than its first few milliseconds.
//
// No Onsets UGen: the browser build of scsynth has no MachineListening plugin.
// This is the plain amplitude version. A fast envelope against its own slow
// background — which rises slowly and falls fast, as `ssp_call_listen`'s does —
// so a sound is an onset when it jumps `threshold` times above what came just
// before it. A held note lifts the background and stops firing; a note struck
// again out of its own tail still clears it.
//
// `Trig1` wants a rising edge, so a sustained sound fires once, not every
// `holdoff`; `holdoff` is how soon a second onset can follow the first.
//
// Reaches the page as ['/ssp_onset', nodeId, replyId, frame, peak, freq, hasFreq].
// `frame` is the sample counter at the onset, wrapped at 2^22 as
// `ssp_call_listen` wraps it, so the timing is exact however late the message
// arrives. `peak` is the largest level in the window; `freq` and `hasFreq` are
// `Pitch`'s reading at its end.
SynthDef(\ssp_onset_listen, { |out = 0, gate = 1, threshold = 3, floor = 0.01, holdoff = 0.1,
                         window = 0.05|
    var env, sig, fast, background, trig, frame, later, peak, freq, hasFreq;

    env = EnvGen.kr(Env.asr(0.01, 1, 0.05), gate, doneAction: 2);

    sig = In.ar(NumOutputBuses.ir, 1);
    fast = Amplitude.ar(sig, 0.001, 0.03);
    background = LagUD.ar(fast, 1, 0.2);

    trig = Trig1.ar((fast > ((background * threshold) + floor)), holdoff);

    frame = Latch.ar(Phasor.ar(0, 1, 0, 2 ** 22), trig);
    peak = RunningMax.ar(fast, trig);
    # freq, hasFreq = Pitch.kr(sig, 440, minFreq: 60, maxFreq: 2000, ampThreshold: floor);

    later = TDelay.ar(trig, window);
    SendReply.ar(later, '/ssp_onset', [frame, peak, K2A.ar(freq), K2A.ar(hasFreq)]);

    Out.ar(out, Silent.ar(2) * env);
},
metadata: (
    specs: (
        // How far above the background a sound must jump to count.
        threshold: ControlSpec(1.2, 20, \exp, 0, 3),
        // The quietest level that can count as anything: below it, the room.
        floor: ControlSpec(0.001, 0.2, \exp, 0, 0.01),
        holdoff: ControlSpec(0.03, 1, \exp, 0, 0.1)
    ),

    frozen: (
        out: 0,
        // Must stay shorter than `holdoff`, or a second onset moves the frame
        // before the first is reported.
        window: 0.05
    ),

    supplied: (
        gate: 1
    )
))
