# The sidecar

Everything SuperCollider-side: authoring SynthDefs, compiling them, asserting them, and the live
rig for tuning one by ear.

The browser proves a def ships. The sidecar is where you decide what it should sound like.

```
sidecar/
├── synthdefs/*.scd        what you write
├── live.scd               the authoring rig
├── live_pattern.scd       the pattern it plays
├── build.scd              compiles synthdefs/ -> out/
├── test.scd               assertions, no server needed
├── lib/                   shared helpers
├── tests/
│   ├── fixtures/          deliberately-broken defs, one per rule
│   └── reload_continuity.scd
├── bin/                   the Node drivers
├── out/                   scratch, gitignored
└── dist/                  committed output: binaries + contracts + manifest
```

---

## The live rig

```sh
npm run sc:live ssp_sine          # opens stopped
npm run sc:live ssp_sine play     # starts immediately
```

Boots a real scsynth, opens a window with a control per parameter, and plays the def under a
pattern. **Saving the `.scd` reloads it without stopping the pattern.**

### The window

| | |
|---|---|
| **play / stop** | starts and stops the pattern |
| **reset** | every slider back to the def's declared defaults |
| **status line** | confirms each reload, and names any control you just added |
| **sliders** | one per `specs` control, over its declared range |
| **grey lines** | `frozen` and `supplied` controls, which deliberately have no slider |

### The loop

1. `npm run sc:live ssp_sine play`
2. Edit `sidecar/synthdefs/ssp_sine.scd` in any editor.
3. Save. Within 250 ms the status line says `reloaded`.
4. The next event uses the new sound. A note already sounding finishes on the old one.

Move sliders while it plays; values land on the next event.

### Adding a control

Add the argument, use it in the graph, and classify it in the `metadata` block — all three, or the
build will tell you which you missed:

```supercollider
SynthDef(\ssp_sine, { |out = 0, freq = 440, amp = 0.2, gate = 1, cutoff = 3000|
    var env = EnvGen.kr(Env.adsr(0.01, 0.1, 0.7, 0.3), gate, doneAction: 2);
    Out.ar(out, Pan2.ar(LPF.ar(SinOsc.ar(freq), cutoff) * env * amp, 0));
},
metadata: (
    specs: (amp: \amp, cutoff: ControlSpec(100, 10000, \exp, 0, 3000)),
    frozen: (out: 0),
    supplied: (freq: 440, gate: 1)
))
```

Save, and the panel rebuilds with the new slider at the bottom. **Your existing slider positions
survive** — values live in the rig's parameter dictionary, not in the widgets. Values for controls
you removed are dropped.

Forget the metadata entry and the build refuses it by name:

```
SSP_BUILD FAIL ssp_sine parameter contract: ('unlisted': [ cutoff ], ...)
```

That is the point: an unclassified argument would reach no UI and no pattern, and sit silently at
whatever the SynthDef declared.

### The pattern

`sidecar/live_pattern.scd` is an event pattern, reloaded on save like the def:

```supercollider
Pbind(
    \dur, Pseq([0.25, 0.25, 0.5], inf),
    \legato, 0.8,
    \freq, Pseq([220, 277.18, 329.63, 277.18], inf)
)
```

**Keys here override their sliders.** Sequence what should move; leave the rest to the sliders. A
control the pattern sets should be `supplied` in the metadata, so it gets a grey line rather than a
fader that appears broken.

### What it will not do

- It does not write to `dist/`. Tuning in the rig changes nothing on disk — when you like what you
  hear, put the values back into the `.scd` as defaults and run `npm run sc:promote`.
- It does not prove the def works in a browser. That is the e2e suite's job.

---

## Commands

| | |
|---|---|
| `npm run sc:live <def> [play]` | the authoring rig |
| `npm run sc:build` | compile `synthdefs/*.scd` into `out/` |
| `npm run sc:test` | assertions — no server, fast |
| `npm run sc:continuity` | boots a server, proves a save does not stop the pattern |
| `npm run sc:manifest` | describe `out/`, fail if `dist/` disagrees |
| `npm run sc:promote` | accept `out/` into `dist/` |
| `npm run sc:verify` | build, test, continuity, manifest |
| `npm run survey` | ask a real browser engine which defs load |

`npm run verify` — the web gate — deliberately excludes all of these, because CI has no
SuperCollider. `sc:verify` is the local gate for a synthdef change.

---

## When it goes wrong

**It hangs instead of failing.** sclang drops to its REPL on any error, so the script's own
`0.exit` never runs. `bin/sc.mjs` kills it after `SSP_TIMEOUT_MS` (default 120 s) and says so.
Shorten the wait while iterating: `SSP_TIMEOUT_MS=15000 npm run sc:build`.

**Nothing is printed at all — not even an error.** That is a parse error: the whole file silently
fails to execute. The one that bites is `var` inside a parenthesised block, which is only legal at
the start of a function body. Use `{ ... }.value` instead of `( ... )`.

**`reload FAILED` in the status line.** The file did not evaluate to a SynthDef. The post window
has the real error. The rig keeps playing the previous version, so you can fix it without losing
your place.

**A class is missing that you know you have installed.** The sidecar compiles against a generated,
quark-free class path — see [SYNTHDEFS.md](SYNTHDEFS.md#the-hermetic-class-path). That is
deliberate: it means a def that works here compiles in CI. To add a quark back:

```sh
SSP_INCLUDE_PATHS=/path/to/quark npm run sc:live ssp_sine
```

The build says so when you use it, because at that point it is no longer hermetic.

**`sclang` not found.** Resolved from `$SCLANG`, then the standard macOS app path, then `PATH`.
Set `SCLANG=/path/to/sclang` if yours is elsewhere.

**A def plays but never stops, or `\legato` does nothing.** It has no `gate`. The event system only
sends gate-off when `desc.hasGate` is true. `sc:test` asserts this, so it should not reach the rig.

---

## How it reaches the browser

`sc:build` resolves every spec to numbers and writes `<name>.contract.json` beside the binary,
because `writeDefFile` hides metadata in a `.txarcmeta` sidecar only SuperCollider can read. Both
are promoted into `dist/`, folded into `manifest.json`, and staged into each app by the Vite vendor
plugin — so a page can build its control surface from the same declaration the rig draws its
sliders from.

The mapping is implemented twice, in sclang and in TypeScript, and
`packages/engine/test/contract.test.ts` checks the TypeScript against a truth table generated by
SuperCollider itself. If the two drift, the sound you tuned by ear stops being the sound the page
makes.

See [SYNTHDEFS.md](SYNTHDEFS.md) for the contract, the format and the compile pipeline.
