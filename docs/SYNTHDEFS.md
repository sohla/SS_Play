# SynthDefs

Authored SynthDefs live in `sidecar/synthdefs/*.scd` and are compiled to
`.scsyndef` by headless sclang. Compiled output is committed, so the web build and CI never need
SuperCollider installed.

## The pipeline

```
sidecar/synthdefs/ssp_sine.scd
  │  npm run sc:build       headless sclang -> sidecar/out/
  ▼
sidecar/out/ssp_sine.scsyndef + sc-version.txt
  │  npm run sc:test        SynthDescLib assertions -> SSP_TEST lines, exit code
  │  npm run sc:manifest    parse the binaries, diff against dist/
  ▼
sidecar/dist/   COMMITTED   binaries + manifest.json
  │  the Vite vendor plugin stages what each app declares
  ▼
apps/<page>/public/vendor/supersonic/synthdefs/
```

`npm run sc:promote` is the only thing that writes `dist/`, and it is deliberate. `sc:manifest`
fails when `out/` and `dist/` disagree, naming each def and its sha256 change, so a synthdef edit
arrives in review as a readable diff rather than as a silent rebuild.

## Writing one

Each file is an expression that evaluates to a `SynthDef`, so it stays independently loadable in
the IDE and the build needs no registration convention:

```supercollider
SynthDef(\ssp_sine, { |out = 0, freq = 440, amp = 0.2, pan = 0,
                      attack = 0.01, sustain = 0.5, release = 0.1|
    var env = EnvGen.kr(Env.linen(attack, sustain, release), doneAction: 2);
    Out.ar(out, Pan2.ar(SinOsc.ar(freq) * env * amp, pan));
})
```

Two rules the build enforces:

- **Names start with `ssp_`.** The synthdefs package stages 131 `sonic-pi-*` defs into the same
  directory; the prefix makes a collision impossible rather than unlikely.
- **Every def must free itself.** `desc.canFreeSynth` is asserted, so a missing `doneAction` fails
  at authoring time. In the browser it would instead surface as `maxNodes` exhaustion partway
  through a performance, with new notes silently failing to start.

Add the control list to `sidecar/tests/contracts.scd`. Pages address controls by name and the e2e
suite sends them positionally, so pinning the exact ordered list turns a rename or reorder into a
visible diff instead of a silent break.

## The live rig

```sh
npm run sc:live ssp_sine
```

Boots a real scsynth, plays the def under a pattern, and opens a window with a slider for every
control. **Saving the `.scd` reloads it without stopping the pattern** — the next event uses the new
sound while the note already sounding finishes on the old one, which is what makes it usable for
tuning by ear.

This is the counterpart to the browser: the browser proves a def ships, the rig is where you decide
what it should sound like.

| | |
|---|---|
| **play / stop** | starts and stops the pattern |
| **sliders** | one per control, generated from the compiled descriptor |
| **reset sliders** | back to the def's declared defaults |
| **status line** | confirms each reload, so you know the save landed |

`sidecar/live_pattern.scd` drives it and is **also** reloaded on save, so the sequence can be
edited while it plays. Keys in the pattern override their sliders; anything the pattern doesn't
mention keeps its slider value. Sequence what should move, leave the rest to the sliders.

Three details that matter in use:

- **Sliders survive a reload.** Rebuilding them on every save would throw away the tuning you were
  in the middle of. They are only rebuilt when the control surface actually changes — add or remove
  a control and the window updates.
- **Ranges are inferred.** A SynthDef declares a default, not a range. Standard names (`freq`,
  `amp`, `pan`) use SuperCollider's published specs; anything else gets a range derived from its
  default. A guess, but a usefully-shaped one — widen it by naming the control conventionally.
- **It uses the same hermetic class path as the build.** A def that works in the rig is a def that
  will compile in CI. Inheriting your global config instead would let you author something against
  a quark and discover the problem much later.

Closing the window stops the pattern and frees the server's nodes. Ctrl-C in the terminal ends the
process.

## The hermetic class path

The build generates its own `sclang_conf.yaml` into `out/` rather than inheriting yours, which
globally injects seven quarks. A build that inherits them breaks when a quark is installed or
removed, and produces bytes that depend on personal machine state.

**`excludeDefaultPaths` drops `SCClassLibrary` itself, not just the extension directories.** Verified:
with an empty `includePaths`, sclang reports *"Library has not been compiled successfully"* and
exits 1. The class library has to be named back explicitly — which is why the config is generated
from the resolved sclang path rather than committed with a hardcoded one.

With it named back: 2263 classes compile, and `JSONlib` and `Spectrogram` are absent where the
default config has them. That is the check that hermeticity is real.

`SSP_INCLUDE_PATHS` (colon-separated) adds paths back for a def that genuinely needs a quark. The
build says so when you use it, because at that point it is no longer hermetic.

## What the browser supports

`npm run survey` loads every vendored def into a real engine and writes `docs/UGEN-SURVEY.json`.

Current result: **130 of 131 load, and every UGen class in the corpus is supported** — 117 of them.
There is no UGen in the shipped library that the browser build cannot run.

The one failure is `sonic-pi-mixout`, which is shipped corrupt upstream, and it fails with
`/d_recv unknown exception` — the same opaque message recorded in `moovit`'s `LESSONS_LEARNED`.
Worth knowing: that error means a malformed synthdef, and it names nothing.

**The constraint runs the opposite way to what you would expect.** `SPLimiter2` works in the
browser but is *not* installed in this machine's sclang, so a def using it would fail to compile
locally while running fine once deployed. The browser build carries sc3-plugins UGens the local
SuperCollider does not. If a def won't compile, check whether the UGen is in the survey before
assuming the browser is the limitation.

### Why the survey has to watch replies

`loadSynthDef` fetches the bytes, extracts the name, and calls `send('/d_recv', …)` — which is
**synchronous and returns void**. Awaiting it proves only that the file was fetched and dispatched.

scsynth reports acceptance as `/done` and refusal as `/fail`, asynchronously. The first version of
the survey awaited `loadSynthDef` and reported a confident 131/131, including the file that cannot
possibly load. It now awaits `sync()` after each load — which resolves only once every prior async
command has completed — and reads the `/fail` stream.

## Running it

```sh
npm run sc:build      # compile
npm run sc:test       # assert
npm run sc:manifest   # describe and check against dist/
npm run sc:promote    # accept the change into dist/
npm run survey        # ask a real engine what loads
```

`sclang` is resolved from `$SCLANG`, then the standard macOS app path, then `PATH`.

**Any error in a `.scd` leaves sclang alive at its REPL** — the script's own `0.exit` never runs, so
a failure looks like a hang rather than an error. `bin/sc.mjs` kills it after `SSP_TIMEOUT_MS`
(default 120s) and says so. A parse error is worse still: nothing is printed at all, not even the
error. If a script produces no output whatsoever, suspect a syntax error — `var` inside a
parenthesised block is one that bites, since `var` is only legal at the start of a function body.
