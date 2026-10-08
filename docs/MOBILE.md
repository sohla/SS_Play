# Mobile first

A phone is the primary target. The IMU and the multitouch screen are instruments here, not
accessibility extras, so the layout is designed at 375px and the `sm:` breakpoint adds back what a
pointer and a wide window allow — not the other way round.

## The rules

**44px minimum on anything you tap.** Apple's figure, and it is about a thumb rather than a
fingertip. The boot button and every slider meet it; `tests/e2e/mobile.spec.ts` asserts it, because
a control that is 10px short is still perfectly usable with a mouse and reliably missed on a phone.

**A slider's hit area is the input's own box, not its track.** The visible track stays 4px through
`::-webkit-slider-runnable-track`, while the input is 44px tall. Styling only the track leaves a
4px band to aim at.

**`appearance: none` removes the thumb, and `accent-color` stops applying once it is gone.** Chrome
still paints one anyway; **Safari does not**. So a range input with `appearance-none` and no
`::-webkit-slider-thumb` rule has no visible thumb on exactly the device this is aimed at, and looks
perfect on the machine you are building on. Both thumbs are declared in
[`packages/ui/src/ui.css`](../packages/ui/src/ui.css).

**Nothing may scroll sideways.** See below — this is the one that actually bit.

**Inputs are at least 16px.** iOS zooms the page in when you focus anything smaller, and does not
zoom back out. The typed-value fields are deliberately small on desktop, so `ui.css` raises them on
touch rather than enlarging every control everywhere.

**`touch-action: manipulation` on anything interactive.** It removes the ~300ms delay Safari holds
for double-tap-to-zoom. On a control surface that delay is the difference between a button feeling
connected to the sound and feeling broken.

## The horizontal overflow bug, because it will happen again

The playground's document was **42,874px wide** in a 390px viewport.

One long OSC address in the log. A flex item's `min-width` is `auto`, not `0`, so the item refuses
to shrink below its content and pushes every ancestor wider — straight through `max-w-3xl`, which
only caps width and does nothing about a child forcing more.

It is invisible on a desktop: the overflow is off to the right where nobody scrolls, and the layout
looks correct. On a phone the viewport scales to the document, so every other column is squeezed to
nothing and values get clipped mid-digit.

**The fix is `min-w-0` on the whole chain of flex and grid ancestors**, not on the scrolling pane
alone. Verified by removing each in turn: putting `pane-scroll` back while leaving the ancestors
without `min-w-0` still overflows. The `overflow-x: auto` only helps once something above it has
agreed to stop growing.

Guarded by `mobile.spec.ts`, which checks `document.scrollWidth <= window.innerWidth` on every page,
and again on the playground after boot — the panels that overflow only exist once it is running.

## What `ui.css` provides

| | |
|---|---|
| `ss-range` | A range input with a 44px hit area and an explicit thumb for WebKit and Gecko |
| `pane-scroll` | A scrolling pane with `min-width: 0`, so it cannot widen its parent |
| `pad-safe` | Gutters that clear the notch and the home indicator via `env(safe-area-inset-*)` |
| `ss-waiting` | The loading stripes — a `repeating-linear-gradient`, so there is nothing to fetch |
| `ak`, `ak-panel`, `ak-label`, `ak-accent`, `ak-live` | AirKit's palette, scoped to a class rather than set in `@theme` |

Shared rather than copied into each app: `index.css` had already been duplicated three times before
this, which is how three pages come to disagree about what a slider looks like.

The `ak` utilities are the one group that is **deliberately not global** — the landing page, the def
browser and the touch surface are not AirKit and should not become it. See
[UI.md](UI.md#the-airkit-palette) for what is in it and why the yellow is `#ffff00`.

## What a phone will actually give you

The two hard limits found by shipping to one, both invisible on a desktop and neither reported as an
error.

### ~3.7MB of decoded audio per page

A sampled page stalls partway through loading once the decoded total passes about 4MB — and stalls by
*never answering*, because `loadSample` ends in `await prepared.allocationComplete` and nothing is
sent when the engine cannot satisfy an allocation. `/piano/` at 3.68MB and `/kit/` at 2.47MB load;
`/marimba/` at 6.78MB and `/dulcimer/` at 9.89MB did not.

Decoded at the **AudioContext's** rate, not the file's, so a 44.1kHz file costs 8.8% more than its
duration suggests. Mono and shorter are the only levers — a lower file sample rate does nothing,
because `decodeAudioData` resamples. Full detail and the two discarded explanations in
[SAMPLES.md](SAMPLES.md#and-the-hard-wall-4mb-of-decoded-audio-per-page).

### The back/forward cache keeps the engine alive

Each boot is ~70MB of WebAssembly, and **a page held in the back/forward cache keeps all of it**. So
leaving one page for another means two engines resident, which on a phone is enough to be killed for.

This was missed for a long time because the desktop measurement said there was no leak — thirteen
navigations holding flat at 79.9MB. Chrome reclaims the memory regardless of what the teardown
achieves, so the test could not see the case that matters. **Flat desktop memory is not evidence that
a page releases anything.**

Two things are needed, in `SuperSonicProvider`:

- **Close the AudioContext synchronously on `pagehide`**, before anything else. `dispose()` closes it
  too, but it is a promise and `pagehide` gives no time to finish one — and the context owns the
  worklet, which is where the memory lives.
- **Reload on a restored `pageshow`.** Having released the engine, a restored page comes back looking
  alive with a closed context behind it: every control responds and nothing sounds, which is worse
  than a reload because it looks like it works.

Memory wins over a seamless back button, at the cost of one reload on a gesture people expect to be
cheap.

## Landed since this page was written

### IMU and multitouch

Both shipped — `packages/motion` with `watchMotion`, and `/touch/` with pointer capture. The notes
below are kept as reference rather than as a plan.

## Still to do

### Orientation and landscape

Untested. A phone held sideways for two-handed playing is the likely performance posture, and
`100vh` is a trap there — iOS Safari's toolbars change the viewport height during a scroll. Use
`100dvh` when something needs to fill the screen.

### IMU — reference

`DeviceOrientationEvent` and `DeviceMotionEvent` need a **user gesture** on iOS:
`DeviceOrientationEvent.requestPermission()` must be called from inside a tap handler, and it
resolves to `'granted'` or `'denied'`. It also requires a secure context, which is why
`npm run dev:lan` exists with mkcert rather than plain HTTP over the LAN.

What it came down to:

- It belongs beside the engine, not in a page. `packages/engine` already has the shape for this:
  `mapSpec`/`unmapSpec` work in 0..1, so tilt, a touch position and a MIDI CC can feed the same path
  as a slider without any of them knowing a parameter's range.
- Sample rate is ~60Hz, far above the rate at which a control should re-render. This is what
  `useOscTap` is for — drive a ref or a canvas, never `setState` from the event.
- Gravity is in the signal. `accelerationIncludingGravity` is usually what you want for tilt;
  `acceleration` for shakes and hits.
- Permission is per-origin and remembered, so the page has to handle "already denied" without a
  prompt — which is a UI state, not an error.

### Multitouch — reference

- `touch-action: none` on a surface that handles its own gestures, or the browser steals the drag
  for scrolling. Scoped to that element: setting it on `body` breaks ordinary scrolling everywhere.
- Pointer Events over Touch Events — `pointerdown`/`pointermove` with `setPointerCapture` give one
  code path for touch, pen and mouse, and capture is what stops a finger sliding off the element
  from ending the gesture.
- `event.pointerId` identifies a finger across its lifetime. Tracking by index breaks the moment a
  finger lifts mid-chord.
- iOS Safari supports `touches[n].force`, which is worth having for velocity.
- Playwright can drive this: `page.touchscreen`, and `hasTouch: true` on the context. The drag test
  in `mobile.spec.ts` is the pattern.

## Latency

Measured on Chrome/macOS, same method before and after, by capturing audio and comparing the first
sample above threshold against `AudioContext.currentTime` at the press:

| | before | after |
|---|---|---|
| `baseLatency` (render buffer) | 5.8 ms | **2.9 ms** |
| `outputLatency` (driver + hardware) | 32 ms | **24 ms** |
| press → first rendered sample | 3.0 ms | 2.9 ms |
| press → half amplitude | ~8 ms | **4.0 ms** |

**The engine is not the problem.** Press to first rendered sample is one render quantum — there is
no scheduler, no lookahead and no event-system delay between a touch and scsynth. That was worth
measuring before changing anything, because the obvious suspects were all innocent.

Two things were worth changing:

- **`latencyHint: 0` instead of `'interactive'`.** Chrome serves `'interactive'` with a 256-frame
  buffer and `0` with 128. It is a hint, not a demand: a device that cannot keep up returns a larger
  buffer rather than glitching, which is why `createSession` asks for it everywhere. Set in
  `DEFAULT_AUDIO_CONTEXT_OPTIONS`.
- **A 2ms attack on the touch page**, against the SynthDef's own 10ms default. The note is audible
  almost immediately and then takes another 10ms to arrive, which is heard as softness rather than
  as delay — and is the part a player actually notices. The def keeps its gentler default, because
  patterns and patches want it; the page overrides for itself.

Roughly 46 ms to 31 ms end to end. The remaining 24 ms is `outputLatency`, which is the OS and the
hardware and is not reachable from a web page.

`tests/e2e/touch.spec.ts` asserts the buffer stayed small and that a press reaches the output inside
15 ms, so a scheduler reappearing between press and engine fails a test rather than being noticed
by ear months later.

### Still unmeasured on a real phone

Every figure above is a desktop browser. iOS Safari's `outputLatency` is typically worse and varies
with whether anything else holds an audio session. The touch page shows its own measured figure in
the control bar for exactly that reason — on a device that cannot be instrumented from here, the
page has to report its own number.
