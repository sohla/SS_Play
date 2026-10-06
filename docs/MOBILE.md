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

Shared rather than copied into each app: `index.css` had already been duplicated three times before
this, which is how three pages come to disagree about what a slider looks like.

## Still to do

### Orientation and landscape

Untested. A phone held sideways for two-handed playing is the likely performance posture, and
`100vh` is a trap there — iOS Safari's toolbars change the viewport height during a scroll. Use
`100dvh` when something needs to fill the screen.

### IMU

`DeviceOrientationEvent` and `DeviceMotionEvent` need a **user gesture** on iOS:
`DeviceOrientationEvent.requestPermission()` must be called from inside a tap handler, and it
resolves to `'granted'` or `'denied'`. It also requires a secure context, which is why
`npm run dev:lan` exists with mkcert rather than plain HTTP over the LAN.

Design notes for when it lands:

- It belongs beside the engine, not in a page. `packages/engine` already has the shape for this:
  `mapSpec`/`unmapSpec` work in 0..1, so tilt, a touch position and a MIDI CC can feed the same path
  as a slider without any of them knowing a parameter's range.
- Sample rate is ~60Hz, far above the rate at which a control should re-render. This is what
  `useOscTap` is for — drive a ref or a canvas, never `setState` from the event.
- Gravity is in the signal. `accelerationIncludingGravity` is usually what you want for tilt;
  `acceleration` for shakes and hits.
- Permission is per-origin and remembered, so the page has to handle "already denied" without a
  prompt — which is a UI state, not an error.

### Multitouch

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

### Audio latency on a phone

Not measured. `baseLatency` and `outputLatency` are readable from the AudioContext and worth
surfacing next to the transport mode, since a page that reports `sab` can still feel slow if the
device buffer is large.
