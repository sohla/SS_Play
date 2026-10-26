# Flock

`/flock/`: one herd of particles that is the same herd on every screen, with nothing exchanged
between them. Each device is a window onto it. Tilt pulls the herd toward the phone, shake scatters
it, and the particles in view sound as grains.

It is a prototype for the Now or Never 2027 open call (theme: *The Next Five Billion Years*), where
the piece is a hive of phone screens acting as one organism. Read [`sync`](../apps/sync/src/rhythm.ts)
and `GridConductor` first: this page is that idea applied to a picture as well as a sound.

## How it works

**The flock is a function of the clock, not a simulation.** `particlesAt(wallMs)` in
`apps/flock/src/flock.ts` returns every particle's position for an instant. Boids would be stateful,
so two phones would agree only if they started together and never stalled. Here a phone that joins
late, or returns from a backgrounded tab, is already in the right place with nothing to catch up on.

It is built to read as a flock, not to be one:

- four sub-flocks wander slow Lissajous paths across a world `WORLD` (5) units wide
- each particle trails its flock's centre by `lag` seconds, so the herd has a tail
- each orbits the centre on an ellipse stretched along the flock's heading, breathing on a 9s cycle
- every period is an **integer number of seconds** and every phase uses `t % period`. This is
  load-bearing: a non-integer period, or a remainder taken against something that does not divide the
  cycle, puts a visible jump in the motion every so often. There is a test for continuity.

**The hive is a set of windows.** The world is a torus; one unit is the shorter side of a screen.
Each device sits at a `slot` (kept in `localStorage`, drawn from the middle of the world so a window
is not silent for minutes). Nothing tells a window where any other window is, but they all look at
one herd, so it crosses from screen to screen on its own timing.

**The phone only affects itself.** `perturb()` bends a particle's offset from the window's centre:

| Input | Effect |
|---|---|
| tilt (roll, pitch, relative to the first reading) | a gravity well that draws nearby particles in |
| shake (and half of turn rate) | outward scatter from the centre |
| pointer, when no motion is live | the same two, so the page can be played on a laptop |

Both are the identity when the phone is at rest, so the shared flock is untouched until someone
touches it. **None of this is shared between devices.** Sensing is local because sharing it needs a
relay (see below).

**Sound** runs through `GridConductor` on a 125ms grid. `grainsForStep(step, …)` is a pure function
of the step, the window and the local state: each visible particle fires with a probability set so the
total is a few per step however crowded the window is (a dense herd gets thicker, not louder, with
more voices). Height in the window sets pitch (D minor pentatonic over three octaves), horizontal
position sets pan, `VOICE_CAP` (8) caps each step. The voice is `ssp_sine`.

The draw loop, the sensor handler and the scheduler all read refs. Nothing is `setState` from a
sensor or OSC callback; the readout is a 4Hz interval.

## URLs

| | |
|---|---|
| `/flock/` | this device's window |
| `/flock/?slot=2.2,2.4` | a window at a chosen spot, for two browser windows on one machine |
| `/flock/?view=all` | the whole world, no sound. What a projector would show |

## Running it

```sh
npm run dev -w @ss/flock      # http://localhost:3052/flock/
npm run sc:build              # compiles ssp_sine; needs SuperCollider
npx vitest run apps/flock
```

iOS grants motion only from a tap inside a secure context. `requestMotion()` is called in the same
tap that boots the engine; use `npm run dev:lan` (mkcert) to test on a phone.

## Verified and not

Verified: typecheck, the full unit suite, the build, `infra:check`, and the picture, by loading the
built page in Chromium at overview and two phone-sized slots.

**Not verified:**

- **Any audio.** The environment this was written in had no `sclang`, so `ssp_sine` was never
  compiled or heard. Grain level, density and the pentatonic mapping are untuned.
- **Any real phone.** Tilt and shake directions are derived from `pose.ts` by reading, not by
  holding a device. If they feel backwards, flip a sign in `enableMotion` in `App.tsx`.
- **Frame rate and battery** on an older handset. 480 particles are evaluated per frame, plus a
  second pass for velocity.
- **No e2e spec exists** for this page yet. `tests/e2e/sync.spec.ts` is the model: two contexts, same
  slot, same step.

## Not done, in order of value

1. **A relay.** The idea that matters for the open call is the audience moving the herd together:
   one person's shake sending a wave through every screen. That needs a small WebSocket relay, which
   breaks the static-files-only shape of this repo. Keep the clock as the fallback so the flock keeps
   moving if the relay drops, and send *perturbations only*, never the flock or the music, so sync does
   not depend on it. The seam is `Local` in `flock.ts`: today one per device, later a shared field.
2. **Section timeline.** The clock can also drive form: `floor((now - T0) / sectionMs)` picking the
   rules (density, tuning, how tightly the flocks cohere). Keep `eventsFor` stateless and seed any
   randomness from the step, as `hash(i, step)` does here. Ramp section changes over several
   seconds; device clocks can differ by a couple of hundred milliseconds, so a hard cut is audible.
3. **Tuning.** Grain envelope, level against voice count, whether pitch-by-height reads as a
   contour, whether four flocks is the right number.
4. **Positions.** Windows do not know where each other are. Declared positions (a QR per seat or
   floor marker) would be exact indoors and need no sensing; GPS is too coarse for a crowd.

## Why a few things are the way they are

- **Scatter is bounded by clock error.** Wi-fi phones are typically 1-10ms from true, cellular ones
  average ~190ms and have been seen past 800ms (`stepAt` in `grid-conductor.ts`). Write for scatter
  of a couple of hundred milliseconds: soft grains, long envelopes, no tight unison hits.
- **No third-party subresources.** `require-corp` blocks them. Draw with canvas 2D; do not reach for
  a particle library from a CDN.
- **`?view=all` does not boot the engine.** A projector page has no reason to make sound.
