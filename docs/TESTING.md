# Testing

Three tiers in the browser plus two SuperCollider-side, each catching something the others cannot.

| | What it proves | Needs |
|---|---|---|
| **Tier 1** — unit | logic is right | nothing |
| **Tier 2** — binary contract | the compiled artefact matches its source | nothing |
| **Tier 3** — e2e | the page boots, isolates, and **makes the right sound** | Chrome |
| `sc:test` | a SynthDef compiles and declares what it claims | SuperCollider |
| `sc:continuity` | saving a def does not stop the pattern | SuperCollider + a server |

```sh
npm run verify      # tiers 1-3. The web gate.
npm run sc:verify   # the SuperCollider gate.
```

`verify` excludes everything needing SuperCollider, because CI has none.

## Tier 3 and the audio assertions

`tests/e2e/audio.spec.ts` is the only place that asserts the engine made the **right** sound.
Everything else in the suite would pass just as well if the graph never reached an output — the
engine would still report success, metrics would still climb, `/n_end` would still arrive.

It works through `startCapture` / `stopCapture`, which hand back the actual rendered samples.

### Five rules that keep it honest

**1. Synchronise on OSC and on the frame counter, never on a clock.** `sync()` before, a
`waitForNodeEnd` promise registered before `/s_new`, and a poll of `getCaptureFrames()` to let it
sound. Sleep-based audio tests are the main source of flakiness in a suite like this, and a flaky
suite gets retried, then skipped, and then the project has no audio verification at all.

**2. Analyse in the page, return scalars.** `stopCapture` yields 40k+ floats; moving those over CDP
is slow and occasionally truncates. Only numbers cross the boundary.

**3. Trim to the middle 60%.** The edges are attack and release ramps. Including them turns every
threshold into a statement about envelope shape rather than about the sound.

**4. Three independent assertions, each catching a different failure.**

| | Catches |
|---|---|
| **energy** — `rms` in 0.01…1 | silence, and a runaway gain |
| **headroom** — `peak` in 0.05…0.99 | inaudibly quiet, and clipping |
| **spectrum** — Goertzel at f₀ ≥ 10× at f₀×1.5 | *made a sound* vs *made the right sound* |

The third is the one that earns its keep. A wrong default, a swapped argument or a replaced
oscillator all produce audible output that sails past the first two.

**5. Never assert exact values.** Not samples, not frame counts, not levels. Bands and ratios only.

> Relaxing a threshold requires a comment giving the physical reason. Without one, the test is
> reporting a real bug.

### The assertions can fail — verified, not assumed

A green audio suite is worthless if it cannot detect a wrong sound, so the spectral assertion was
checked against two deliberate mutations of `ssp_sine`:

| Mutation | Result |
|---|---|
| `SinOsc.ar(freq)` → `SinOsc.ar(freq * 1.5)` | both spectral tests fail; energy and headroom still pass |
| `SinOsc.ar(freq)` → `WhiteNoise.ar` | both spectral tests fail; energy and headroom still pass |
| routing: source `addToHead` → `addToTail` | the effect reads an empty bus; capture is exactly 0 |

That split is exactly the point: in the first two the sound was still there, still the right
loudness, and still completely wrong.

The routing mutation is worth describing precisely, because the first one tried did **not** fail.
Changing the *effect's* `addAction` from `addToTail` to `addToHead` changed nothing: a group runs
head to tail, and the source is added to the head afterwards, so it lands first either way. Only
moving the *source* to the tail actually inverts the order. A mutation that fails to fail is useful
information — it means the thing you thought you were testing is not the thing under test.

There is also a silence test, which proves the measurement can come back empty — so a passing run
means the engine produced something rather than the harness always reporting that it did.

### What each audio test covers

| | |
|---|---|
| sine: energy, headroom, frequency, DC | the baseline signal |
| frequency follows the request | rules out a def emitting a fixed tone regardless |
| amplitude tracks `amp` | the control does something monotonic |
| noise is broadband, not tonal | the contrast that makes the spectral test meaningful |
| a lowpass cutoff removes high end | the filter working, not merely present |
| silence | the measurement can fail |
| a sample loads, decodes and plays | `loadSample`, the buffer allocator, Chrome's FLAC decode |
| an effect reads a private bus | `In.ar`, bus routing, and node order |

### Constraints worth knowing

- **`getMaxCaptureDuration()` is 1 second.** Captures must be shorter; the tests use ~0.4s.
- **Capture is SAB-only.** Every audio test asserts `mode === 'sab'` first, because a page that
  silently fell back to postMessage would return empty buffers and every assertion would be about
  nothing.
- **`--mute-audio` does not affect capture.** Verified by running with and without: it mutes the
  output *device*, while capture taps the worklet upstream of it.
- **`Pan2` at centre scales by ~0.707**, so a `0.3` amplitude peaks around `0.21`. Worth
  remembering before calling a level wrong.
- **Only the defs named on the provider are loaded at boot.** The capture helper loads a def before
  playing it; without that you get `/fail "SynthDef not found"`, which presents as silence. Every
  audio test asserts no `/fail` arrived.

## What is still only checked by a person

That the sound reaches a speaker. Capture taps the worklet's output ring, which proves the engine
produced samples — not that a device played them. Confirmed by ear on desktop Chrome and on an
iPhone; see `docs/LOG.md`.

## CI

Runs tiers 1 and 2, typecheck, the build, and the Caddyfile drift check. It does **not** run
Tier 3: a clean runner has no Chrome channel, and capture thresholds on shared hardware are a
flake factory. Tier 3 and the SuperCollider gates are local, before a deploy.
