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

`combo.spec.ts` and `thrum.spec.ts` also capture, and both deliberately make a smaller claim:
**energy and headroom only**, no spectral assertion. Three layers sounding at once is the case where
clipping would appear, which is worth checking either way; but "the right sound" for a page whose
pitch set and subdivision move with the phone is not a frequency you can name in advance, and on
`thrum` it is not a frequency at all — [most of what that page emits is not meant to be
audible](HAPTICS.md), so a spectral threshold would be measuring the part that matters least.

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

## Asserting the brief rather than the plumbing

A page spec that only proves the page boots proves the least interesting thing about it. Where a page
has a stated brief, the spec is written against *that*:

| spec | asserts |
|---|---|
| `combo.spec.ts` | the two gestures are **separable** — shaking hard without turning must not open the harmony, and turning hard without shaking must not change the rhythm. Those two tests *are* the brief. Plus: every layer's count per bar is a power of two, the root only visits the four chords in the progression, it moves at most once per 2s bar, and the melody stays inside the pool it was given |
| `plotter.spec.ts` | that the pages plot the right number of series **in AirKit's colour order**, read back off the canvas pixels |
| `zz-sens.spec.ts` | that the same fixed gesture at two sensitivities reads differently. Comparative, never absolute |
| `thrum.spec.ts` | that the Demand clock spawns taps **and frees every one** — a 12ms one-shot is where a missing `doneAction` hides — that the three gestures reach three different layers, and that three layers driven at once do not clip |

`thrum`'s own boundaries are in `apps/thrum/test/layers.test.ts` instead, and that split is worth
copying. The claims are about numbers — the ~6Hz rate below which taps stay countable, the ~25ms
duration at which a burst stops being a tap, the five regimes one turn of the wrist has to cross — so they
are asserted against the mapping across a hundred-step sweep at six sensitivities, which costs
milliseconds. Doing the same thing through a browser would be a hundred page loads to check
arithmetic. **Put a boundary where it is cheap and put the mechanism where it is real.**

Three things learned writing them:

- **A fire-and-forget helper overlaps the next one.** `move()` in `thrum.spec.ts` arms an interval
  inside `page.evaluate` and returns immediately, so two calls in sequence both run: the first was
  still dispatching rotation while the second was supposed to be showing what shaking alone does, and
  the separability test compared a number with itself and passed the comparison as `70.8 > 70.8`.
  Fixed by having the helper await its own duration. **A test that reads a value during an
  overlapping gesture is testing nothing and says so quietly** — the failure message was a tautology,
  which is the tell.
- **Stopping the events is not putting the phone down.** `shake` and `turn` decay on each *incoming*
  event, so a page that simply stops receiving them holds its last reading for ever — the clock keeps
  running and the bed keeps sounding. Settling has to be simulated as zero-movement events, which is
  what `hold()` does and what `personalities.spec.ts` has always done.

- **Read a colour from the canvas, not from the markup.** A Tailwind class that was never generated
  still looks perfectly correct in the DOM. The only way to know a trace is yellow is to sample the
  pixel.
- **A selector that depends on the palette breaks every time the palette does.** `imu.spec.ts` was
  picking a bar marker by `.bg-emerald-400`; the AirKit palette would have broken it. It uses a
  `data-testid` now, which is the rule for anything a restyle can move.

A sensitivity test has to be comparative because there is no correct absolute reading — only the
relation between two. Note also that `playwright.config.ts` sets `workers: 1` and
`fullyParallel: false`, so specs run serially in filename order, and the `zz-` prefix puts that one
last.

## What is still only checked by a person

That the sound reaches a speaker. Capture taps the worklet's output ring, which proves the engine
produced samples — not that a device played them. Confirmed by ear on desktop Chrome and on an
iPhone; see `docs/LOG.md`.

```sh
npm run listen
```

Opens a visible Chrome with the sound **on** and plays the same notes the audio suite measures,
printing each measurement beside it. The point is that the numbers and what you hear can be checked
against each other: if a row looks right and the note sounds wrong, the engine rendered correct
samples that never reached the device — which nothing in the automated suite can tell you.

## The engine specs need a host page

`boot.spec.ts`, `isolation.spec.ts` and the capture helper in `audio.ts` are about
the engine and the build rather than about any page — but they still have to load
*something*. That used to be `/playground/`, the def browser, and when it was
removed they moved to `pages.ts`'s two named hosts:

| | | why |
|---|---|---|
| `ENGINE_HOST` | `/touch/` | boots the engine and **makes no sound of its own** — a capture is worthless if something else is already playing into it |
| `CONTROLS_HOST` | `/thrum/` | the busiest page after boot: nine sliders, a canvas, the longest hint strings here, so it is what catches horizontal overflow |

Both read through `?debug=1` and `window.__ss` rather than through markup, which
is why repointing them was a few lines. **Anything that asserts against a page's
own UI belongs in that page's spec, not here** — six tests in `boot.spec.ts` did
not follow that rule and had to be deleted with the page they were really about.

## When the whole suite fails at boot

Both known causes are **outside the suite**, and both present identically: every
Tier 3 test fails in `beforeEach`, waiting for `[data-testid=playing]` that never
appears. The page renders, the button clicks, and the engine never answers.

| Symptom in the page | Cause | Fix |
|---|---|---|
| `Timed out after 5000ms waiting for /notify` | **A stray `scsynth` holding the audio device** | `pkill -f scsynth` |
| `ERR_CONNECTION_REFUSED` on `:4173` | Two runs contending for the port | kill the other run, or `lsof -ti:4173` |

### The stray scsynth — fixed, and worth knowing anyway

`npm run sc:continuity` boots a real server — `scsynth -u <port> -i 2 -o 2` — and
if it does not exit it keeps the audio input and output. Chrome then cannot get
the device, so the AudioWorklet never starts and `/notify` never arrives.

Nothing about that symptom points at its cause. The engine looks broken, the
build looks suspect, and the suite blames whatever you changed last. It survives
across sessions, so the run that leaks the process and the run that fails can be
an hour and several commits apart.

**`bin/sc.mjs` now reaps it.** It snapshots the running servers before spawning
sclang and kills anything new on the way out, from an `exit` handler plus
explicit `SIGINT`/`SIGTERM`/`SIGHUP` handlers. The script also quits its own
server politely, which covers the ordinary path.

It kills **sclang** first, and the order is load-bearing. Killing this wrapper
does not kill its children, so an interrupted run used to leave sclang behind
even once the server was handled — and that orphan sits inside `waitForBoot`, so
it can boot a *replacement* server minutes later and recreate the problem.
Reaping the server first would be a race against the thing being cleaned up.

Both layers are needed, because two routes skip the polite one entirely:

- **the SIGKILL this wrapper sends when a script hangs.** sclang sits at its REPL
  when a `.scd` throws, so `runSclang` kills it on a timeout — and a killed
  sclang never runs the shutdown hook that posts `/quit`.
- **anything that kills `npm run` from outside.** Which is how the one that cost
  an hour was created.

> **The diff against the snapshot is a safety property, not an optimisation.** A
> SuperCollider user very often has a server running from the IDE, and killing
> that would be a worse bug than the one being fixed. Only PIDs that appeared
> while the wrapper was alive are ever signalled. Verified three ways: a normal
> run leaves nothing; a wrapper killed mid-run reaps its own server; and a server
> started beforehand survives a full continuity run untouched.

```sh
pgrep -x scsynth    # still the first thing to check, if ever in doubt
```

### Run the known-good build first

**The one diagnostic that separates "my change" from "my machine":** point the
same browser at the deployed site.

```sh
SS_BASE_URL=https://playground.soh.la npx playwright test tests/e2e/boot.spec.ts
```

If a build that is known to work fails the same way, the problem is local and
nothing in the working tree is worth reading yet. This costs thirty seconds and
is the first thing to do, not the last — a trivial one-line change was once
debugged for an hour against a Chrome version, swap usage, a byte-compared
vendor tree and a red-herring 404, all of which were fine, because this check
was run sixth instead of first.

A page-level 404 is especially misleading here: `/thrum/`'s engine logs one from
inside a worker (invisible to a response listener and to request interception),
and `/gendy/` logs none at all. Both failed. The 404 was unrelated.

## CI

Runs tiers 1 and 2, typecheck, the build, and the Caddyfile drift check. It does **not** run
Tier 3: a clean runner has no Chrome channel, and capture thresholds on shared hardware are a
flake factory. Tier 3 and the SuperCollider gates are local, before a deploy.
