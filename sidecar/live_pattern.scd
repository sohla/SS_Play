// The event pattern driving the live rig. Reloaded on save, like the SynthDef —
// the Pdef swaps underneath without stopping, so edits land on the next event.
//
// Keys here override the GUI sliders, so sequence what should move and leave
// the rest to the sliders.
Pbind(
    \dur, Pseq([0.25, 0.25, 0.5], inf),
    \freq, Pseq([220, 277.18, 329.63, 277.18], inf) * Pseq([1, 1, 2], inf)
)
