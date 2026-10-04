# Log

Append-only record of steps taken: what changed, what was verified, what is still open.
Newest entry last.

---

## 2026-10-03 — Phase 0: scaffold and pin the API

### Done

- Created the repo at `~/Develop/SuperCollider/Projects/SS_Play`, `git init -b main`
  (`init.defaultBranch` is unset globally, so the explicit `-b` matters or you get `master`).
- `LICENSE`: canonical AGPL-3.0-or-later text from gnu.org. Driven by the dependency — see
  `docs/API-0.88.0.md` §1.
- Root npm workspaces (`packages/*`, `apps/*`), `.npmrc` with `save-exact`, `.nvmrc` 22.19.0,
  `tsconfig.base.json` + `tsconfig.typecheck.json`, `.gitignore`.
- `packages/engine` with `supersonic-scsynth@0.88.0` pinned exact. Tests only, no engine code yet.
- `packages/engine/test/api-surface.test.ts` — walks the prototype chain, asserts the 23 methods
  and 5 accessors the engine depends on, asserts the removed cancellation API stays removed, and
  snapshots the full surface for drift.
- `packages/engine/test/api-types.test-d.ts` — `expectTypeOf` assertions on the type-level facts
  the engine is built on.
- `docs/API-0.88.0.md` — the seven changes from 0.66.0, the option table, what not to reimplement.
- `PLAN.md` moved into the repo from the Claude harness directory so it is versioned and diffable.

### Verified

- `npx vitest run --typecheck` → **61 passed, no type errors**.
- `npm run typecheck` → clean.
- Prototype chain is two levels: `SuperSonic` (1 accessor, 16 methods) over the Clockwork host
  (17 accessors, 48 methods). Inspecting only `SuperSonic.prototype` sees 16 of ~65 members.
- scsynth option table read from the bundle: 10 flags. `maxNodes` 1024, `numAudioBusChannels` 1024
  (was 128), `numControlBusChannels` 16384 (was 4096).
- Metrics schema has four sections; 73 metrics with a max offset of 76, so offsets are
  non-contiguous and array length must never be assumed.

### Found along the way

- **Upstream packaging bug.** `supersonic-scsynth@0.88.0` declares `"types"` but its `"exports"`
  map has no `types` condition, so under bundler resolution the shipped declarations are
  unreachable and the import degrades to `any`. Worked around with one `paths` entry in
  `tsconfig.base.json`; remove it when upstream fixes the condition.
- **`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` does not belong in `.npmrc`.** npm reads it as a config key,
  not an env var, and warns it will stop working. Removed. When Playwright lands in Phase 6,
  install it as `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i -D @playwright/test` — we drive the
  installed Chrome via `channel: 'chrome'`, so the bundled browsers are ~1 GB of waste on a disk
  already at 88%.
- **npm's optional-dependency bug bit immediately.** An incremental `npm i -D @types/node` dropped
  Vitest 5's rolldown native binding (`Cannot find native binding`). Fixed by removing
  `node_modules` and `package-lock.json` and reinstalling. Worth knowing because the symptom looks
  like a broken Vitest rather than a broken install.
- The first run of `api-surface.test.ts` failed one assertion — a `sentinels.HEADROOM_UNSET` key
  carried over from the 0.66 schema that does not exist in 0.88. The test doing its job on day one.

### Open

- Domain name, needed only at Phase 7.
- Whether `sclang -a` needs `SCClassLibrary` named back explicitly in `includePaths` — settle on
  the first sidecar run in Phase 4. The SC source says `setExcludeDefaultPaths(true)` clears the
  default class library directories outright (`lang/LangSource/SC_LanguageConfig.cpp:54`).

---

## 2026-10-03 — Phase 1: workspaces, Vite preset, cross-origin headers

### Done

- `infra/headers.json` as the single header source, `infra/sites.json`, and `infra/gen.mjs`
  rendering `infra/Caddyfile` from both. Domain placeholder is `DOMAIN.invalid` — `.invalid` is
  reserved by RFC 2606, so a half-configured Caddy can never request a real certificate.
- `packages/vite-preset` with `defineSSApp()`: both servers' headers from `headers.json`, React and
  Tailwind plugins, `optimizeDeps` keeping the AGPL core unbundled, and a 32-sample cap per app.
- `packages/ui` with `CheckRow` and `SourceFooter` — the AGPL source link lives in the shared kit
  so no page can ship without it.
- `packages/engine/src/capabilities.ts` — `probeCapabilities()`, pure and scope-injectable.
  Written now rather than in Phase 2 because the playground needs it and it has no SuperSonic
  dependency; writing a throwaway copy in the app would have been worse.
- `apps/playground` reporting the six capabilities and the transport mode it will get.
- `playwright.config.ts` + `tests/e2e/isolation.spec.ts`. **Pulled forward from Phase 6** — see
  below.
- `docs/CROSS_ORIGIN.md`.

### Verified

- `npm run verify` green end to end: `infra:check`, typecheck, **80 unit + type tests**, build,
  **5 e2e tests**.
- Both servers send both headers (`curl -sI` on :3000 and :4173).
- Real Chrome reports `crossOriginIsolated: true`, `SharedArrayBuffer: function`, and the page
  renders transport mode `sab`.
- Tailwind's cross-workspace `@source` works: `bg-emerald-400`, `decoration-dotted` and `min-w-56`
  come only from `packages/ui` and are all present in the built CSS, as is the custom `bg-surface`.
- Exactly one React in `node_modules`; all four workspaces symlinked.
- 13 project files typechecked, including `vite.config.ts` and `headers.json`.

### The anti-drift mechanism was tested, not assumed

Deleted `Cross-Origin-Embedder-Policy` from `headers.json` and confirmed what each layer does:

| Layer | Result |
|---|---|
| `packages/vite-preset/test/preset.test.ts` | failed |
| `npm run infra:check` | exit 1 |
| `tests/e2e/isolation.spec.ts` | 2 of 5 failed |

**That test found a real hole.** The gate was originally
`npm run infra:gen && git diff --exit-code -- infra/Caddyfile`, which reported success — because
the Caddyfile was still untracked and `git diff` cannot see drift in an untracked file. Replaced
with `node infra/gen.mjs --check`, which compares the rendered output against the file's own
contents and does not depend on git state. Verified: exit 1 on drift, exit 0 in sync.

### Found along the way

- **Playwright pulled forward from Phase 6.** Verifying `crossOriginIsolated` needs a real browser;
  `curl` cannot do it and Chrome's `--dump-dom` hung. A hand-rolled CDP client over Node's
  WebSocket also hung, and debugging one was clearly the wrong use of effort when a proven tool was
  already in the plan. Installed with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` and `channel: 'chrome'`:
  **18 MB, no browser cache created**.
- Two of my own test harnesses were wrong before the code was. The first cross-origin assertion
  compared against `page.url()`, which is still `about:blank` when the request listener fires, so
  it flagged the document itself. The first drift check piped `npm run` into `tail`, which masks
  the exit code. Both worth remembering: a green check can mean the check is broken.
- The playground first rendered dark text on white — the components are styled for a dark canvas
  and nothing set a base background. Fixed with a `@layer base` block and `color-scheme: dark`.

### Open

- Domain name, needed at Phase 7.
- CI workflow not written yet. `npm run verify` is the local gate; CI should run everything in it
  except `e2e`, which needs a Chrome channel the runner does not have.

---

## 2026-10-03 — Phase 2: packages/engine and Tier 1 tests

### Done

All pure logic, testable without a browser:

- `scsyndef/` — the v1/v2/v3 parser, reporting bytes consumed and throwing a typed error carrying
  a byte offset.
- `urls.ts` — `resolveEngineUrls`, every URL explicit.
- `boot.ts` — `bootEngine`, never passing `mode`, reporting the achieved transport, with exactly
  one bounded fallback retry.
- `ctl.ts` — `ctl()` with float-by-default and `i()` for integers.
- `dispatcher.ts` — one `on('in')` subscription, address routing, `wait`, `waitForDone`,
  `waitForNodeEnd`, `onTrigger`.
- `buffers.ts` — `BufAllocator` with contiguous runs and reservations.
- `metrics.ts` — `createMetricsPoller`, offsets resolved from the runtime schema, one shared
  interval, reused snapshot object plus a version counter.
- `assets.ts` — `loadSynthDefsChecked`.

### Verified

- `npm run verify` green: **844 unit + type tests**, no type errors, build, 5 e2e.
- The parser runs against the real corpus from `supersonic-scsynth-synthdefs@0.88.0` — 131 files
  spanning all three format versions — asserting byte-exact consumption, name-matches-filename,
  dense parameter indices, and no duplicate names, plus a truncation sweep that cuts every file at
  37-byte intervals and requires a typed error with an offset each time.

### Three real findings, all from the corpus

**1. My own parser bug, caught on the first run.** A UGen input source of `-1` is *legitimate* — it
means the input is a constant, with the paired value indexing the constants array. Validating those
as non-negative counts rejected most real files. Counts and indices are now read separately.

**2. `sonic-pi-mixout.scsyndef` is shipped corrupt in `supersonic-scsynth-synthdefs@0.88.0.`**
The def name `sonic-pi-mixout` (15 chars) was written into a field whose length byte says 14, so
its final `t` (`0x74`) landed on the high byte of the int16 constant count — turning 11 constants
into 29707. The rest of the file is laid out correctly for a 14-char name: restoring byte 25 to
`0x00` parses to exactly 2800/2800 with 11 constants, 24 params and 85 ugens, which is what proves
the cause. **sclang cannot read it either**, so this is upstream. It is excluded from the
must-parse set and pinned by four assertions that will fail when upstream fixes it.

**3. Format 3 grew a trailing section between 0.66 and 0.88.** The two format-3 files are 16 bytes
larger than their 0.66 counterparts, inside the declared per-def length. Rather than special-case
it, the parser now uses the length prefix for what it is for — stepping over sections it does not
model — and surfaces the count as `trailingBytes` so a future format change is visible rather than
silent.

Separately, `sonic-pi-mixer.scsyndef` fails to load in local sclang because `SPLimiter2` is not
installed. That is an environment gap, not a file problem, but it is a preview of Phase 3: the
browser build only has the UGens it was compiled with, and the authoritative list is empirical.

### Open

- Domain name, needed at Phase 7.
- CI workflow.
- Whether `sonic-pi-mixout` and `sonic-pi-mixer` can load in the browser at all — Phase 3 answers
  it by loading all 131 and recording the failures.

---

## 2026-10-03 — Phase 3: scsynth running in the browser

### Done

- `packages/vite-preset/src/vendor.ts` — stages the 0.88 runtime into the app's `public/`:
  `wasm/` and `clockwork_audio_worklet.js` from the core package, the two SAB workers from the
  client package, declared synthdefs and samples, and both LICENSE files.
- `apps/playground/src/engine.ts` — boot, node-notification registration, synthdef load, metrics
  poller, and a beep that waits on `/n_end`.
- Boot button, live engine info, and a metrics panel in the playground.
- `tests/e2e/boot.spec.ts` — eight assertions covering the Phase 3 gate.

### Verified

`npm run verify` green: **852 unit + type tests**, no type errors, build, **13 e2e**.

In a real browser: transport `sab`, 48000 Hz, boot ~800 ms, `sonic-pi-beep` loaded,
`engineProcessCount` climbing, `engineMessagesDropped` 0, `audioHealthPct` 100, and a beep that
plays and frees its own node.

### Four findings

**1. Browser code must never import from `@ss/vite-preset`.** `engine.ts` imported `ENGINE_BASE`
from it, which pulled `fs`, `path`, `node:module`, Tailwind and rolldown into the *client* bundle
and failed as `stream did not contain valid UTF-8`. The path is now injected as a `define`d
constant, `__SS_ENGINE_BASE__`, which is what the plan called for.

**2. `loadSynthDefs` returns an array, not a record.** The shipped typings declare
`Promise<Record<string, { success, error? }>>`, but 0.88 implements
`Promise.all(names.map(loadSynthDef))` — so it returns `{ name, size }[]` and **rejects** on
failure rather than reporting per-item results. Reading an array as a record reports every name as
missing, which is exactly what blocked the first boot: the synthdef had loaded fine.
`loadSynthDefsChecked` now accepts either shape. The 0.66 hazard it was written for no longer
exists; its remaining value is surviving a version that flips back.

**3. scsynth sends no node notifications unless you ask, and SuperSonic never asks.** `/n_go`,
`/n_end`, `/n_on`, `/n_off` and `/n_move` go only to clients registered via `/notify 1`. Without
it `waitForNodeEnd` never resolves — synths play correctly and nothing reports that they finished,
which would have quietly pushed every audio test back onto sleeps. `enableNodeNotifications()` now
does it once after boot, registering the waiter before sending so a fast reply is not missed.

**4. The core package's licence metadata and LICENSE file disagree.**
`supersonic-scsynth-core@0.88.0` declares `AGPL-3.0-or-later` in `package.json` but ships GPL-3.0
text with no mention of Affero. The client package — the one bundled into page JS, and the reason
SS_Play is AGPL — is consistently AGPL in both. No change to our licence: GPL-3.0 code is
compatible with an AGPL-3.0 whole. The e2e spec asserts each file as shipped, so an upstream
correction surfaces.

### Smaller things

- `ERR_ABORTED` on every asset is normal: the library races a HEAD size-probe against the GET and
  cancels the loser. It is not a failure, and it looks exactly like one in devtools.
- The Vite config is loaded by Node, not bundled, so the preset's internal imports need a real
  `.ts` extension — hence `allowImportingTsExtensions`, which is only appropriate because nothing
  in `packages/` is emitted.
- `getInfo().version` is `string | null` and this build reports `null`. Displayed as informational
  rather than as a fault, and deliberately not asserted in the e2e.
- The page now reports an **expected** transport from the probe before boot, as well as the
  **achieved** one after. Showing degradation on load is what `probe()` exists for.
- A stale `vite preview` from an earlier phase was reused via `reuseExistingServer` and served a
  `dist` predating the vendor plugin, which produced convincing 404s. Kill preview servers between
  phases.

### Open

- Domain name, needed at Phase 7.
- CI workflow.
- Loading all 131 defs in the browser to derive the real UGen whitelist — still outstanding, now
  Phase 4 work alongside the sidecar.

---

## 2026-10-03 — Phase 3 confirmed by hand, including on iOS

### Audible output, verified by a person

Every automated test runs Chrome with `--mute-audio`, so until now nothing had confirmed the
engine actually reaches an output device. The e2e proves scsynth renders blocks, accepts `/s_new`
and reports `/n_end` — all of which would pass just as well if the graph never reached the
speakers. **Confirmed by ear on desktop Chrome and on a physical iPhone.**

This stays a manual check. Phase 6 narrows it with `startCapture`/`stopCapture`, which taps the
worklet ring directly — that proves the engine produced samples, still not that a device played
them. The last link in that chain is always a person.

### iOS Safari works, and gets the fast transport

First contact with WebKit rather than Chromium, over `npm run dev:lan` and mkcert TLS on the LAN.
The page loads, the engine boots, and a beep is audible on the device.

**iOS reported `sab`.** Cross-origin isolation and `SharedArrayBuffer` survive the whole chain on
WebKit, which settles three things that were open:

- No iOS-specific degradation to design around. One transport everywhere.
- `startCapture`/`stopCapture` is SAB-only, so the Phase 6 audio assertions **can** run on iOS
  rather than iOS being "works, untestable".
- `require-corp` was the right call over `credentialless`, which Safari does not support. Had we
  taken the looser option for convenience, this device would have been locked out.

Worth knowing for anything that follows: iOS routes Web Audio through the **ringer switch**, so a
silenced phone gives a visually perfect run with no sound — a convincing false negative.

### LAN setup notes

- `SS_LAN=1` is opt-in and changes nothing about the default loop. `http://localhost` is already a
  secure context; only a phone reaching the Mac by IP needs TLS.
- The certificate names the LAN IP explicitly, so it needs regenerating when the DHCP lease moves.
- Getting the CA onto the phone: **AirDrop is unreliable** — a `.pem` lands in Files, where tapping
  it does nothing. Serving the certificate over plain HTTP and opening it in Safari triggers the
  configuration-profile flow properly. Serve `rootCA.pem` only; `rootCA-key.pem` sits in the same
  directory and must never leave the machine.

---

## 2026-10-03 — Phase 4: the sclang sidecar and the binary contract

### Done

- `sidecar/` — hermetic headless sclang build, `SynthDescLib` assertions, manifest with sha256, and
  a committed `dist/` behind an explicit promotion gate.
- `packages/engine/test/sidecar-dist.test.ts` — Tier 2 over the committed output, no SuperCollider
  needed.
- `tools/ugen-survey.mjs` — loads every vendored def into a real engine, writes
  `docs/UGEN-SURVEY.json`.
- `docs/SYNTHDEFS.md`.
- The playground now vendors all 131 defs, which also sets up Phase 5's browser.

### Verified

- `npm run verify`: **867 unit + type tests**, build, 13 e2e.
- `npm run sc:verify`: 2 defs compiled, **17 sclang assertions passed**, `dist/` in sync.
- Every gate was tested by breaking something, not assumed:
  - Reordering two controls → `ssp_sine/controls` fails with an expected-vs-got diff.
  - Changing a default → the promotion gate reports `~ ssp_sine bdc6b2b7d59e -> 5ba43cd404d8`.
  - A def with no `doneAction` → the in-test negative control confirms `canFreeSynth` catches it.

### The `-a` question, settled

The prediction from reading `SC_LanguageConfig.cpp:54` was right.
`excludeDefaultPaths: true` with an empty `includePaths` gives *"Library has not been compiled
successfully"* and exit 1 — it drops **`SCClassLibrary` itself**, not just the extension dirs.
Naming it back gives 2263 classes, and `JSONlib`/`Spectrogram` are absent where the default config
has them, which is hermeticity demonstrated rather than asserted.

### Findings

**1. The browser build is *richer* than the local SuperCollider, not poorer.** `SPLimiter2` loads
fine in the browser but is **not installed in this machine's sclang** — `sonic-pi-mixer` failed to
read locally for exactly that reason. So a def using it would fail to compile here while running
fine once deployed. The plan assumed the constraint ran the other way.

**2. There is no UGen the browser cannot run.** All 117 classes across the corpus are supported;
zero suspect. The planned "UGen whitelist" has nothing to exclude, so it stays a survey artifact
rather than becoming a gate.

**3. The first survey was measuring the wrong thing and said so confidently.** It reported 131/131,
including the file that cannot possibly load. `loadSynthDef` fetches, extracts the name, and calls
`send('/d_recv', …)` — synchronous, returns void — so awaiting it proves only that bytes were
dispatched. scsynth reports refusal asynchronously as `/fail`. The survey now awaits `sync()` after
each load and reads that stream: **130/131**, with `sonic-pi-mixout` failing as
`/d_recv unknown exception`.

That message closes a loop: it is the same opaque error recorded in `moovit`'s
`LESSONS_LEARNED.md`. It means a malformed synthdef, and it names nothing.

**4. Node cannot load the engine's TypeScript until two things are true.** Node 22.19 strips types
natively, but only in strip-only mode: extensionless relative imports do not resolve, and
**parameter properties** (`constructor(readonly x: T)`) are rejected outright, since they require
code generation rather than erasure. Both are now fixed throughout `packages/`, which is what lets
the sidecar reuse the real parser instead of duplicating it.

### Two sclang failure modes worth remembering

- **Any error leaves sclang alive at its REPL.** The script's `0.exit` never runs, so a failure
  presents as a hang. `bin/sc.mjs` kills it after `SSP_TIMEOUT_MS` and explains why — without that
  timeout every mistake costs a wedged terminal.
- **A parse error prints nothing at all.** Not the error, not even output from lines before it —
  the whole file silently fails to execute. `var` inside a parenthesised block is one such error;
  `var` is only legal at the start of a function body. If a script produces no output whatsoever,
  suspect syntax.

### Open

- Domain name, needed at Phase 7.
- CI workflow.
- `npm run verify` deliberately excludes the sclang chain, since CI has no SuperCollider.
  `npm run sc:verify` is the local gate for synthdef changes.
- iOS needs **two** separate actions, and installing alone does nothing: install the profile
  (Settings → Profile Downloaded, or General → VPN & Device Management), **then** trust it
  (General → About → Certificate Trust Settings). Missing the second produces a generic privacy
  warning that reads like a broken certificate rather than an untrusted one.

---

## 2026-10-04 — The live authoring rig

### Done

`npm run sc:live <def>` — boots a real scsynth, plays the def under a pattern, and opens a Qt
window with a slider per control, generated from the compiled descriptor. Saving the `.scd`
reloads it **without stopping the pattern**.

- `sidecar/live.scd` — the rig.
- `sidecar/live_pattern.scd` — the driving pattern, reloaded on save as well.
- `sidecar/bin/live.mjs` — launcher. Deliberately has no timeout, unlike `sc.mjs`: staying open is
  the point.
- Five assertions added to `sc:test` covering the rig's pattern contract.

This is the counterpart to the browser side. The browser proves a def ships; the rig is where you
decide what it should sound like.

### Verified

- `npm run sc:verify`: **22 assertions pass**.
- Hot reload fires for both files: touching `ssp_sine.scd` logs `SSP_LIVE reloaded`, touching
  `live_pattern.scd` logs `SSP_LIVE pattern reloaded`.
- Merge precedence is right — pulled six events from the merged stream: `instrument` from the def,
  `dur`/`freq` sequenced by the pattern, `amp` held by the GUI.
- An unknown def name lists what does exist rather than failing blankly.

### Design decisions worth keeping

- **The rig uses the same hermetic class path as the build.** Inheriting the global config would be
  friendlier in the moment and would let you author against a quark, then discover in CI that it
  cannot compile. What works in the rig compiles.
- **Sliders are not rebuilt on every save**, only when the control surface changes. Rebuilding
  always would discard the tuning you were in the middle of, which is the one thing this tool
  exists to protect.
- **Pattern keys override sliders.** Sequence what should move; leave the rest to the sliders. A
  slider for a key the pattern also sets would otherwise look broken.
- **Ranges are inferred** from the control default, since a SynthDef declares no range. Standard
  names use SuperCollider's published specs.

### Not verified by machine

The rig makes sound through the speakers and opens a window, so the audible behaviour and the GUI
feel are a person's job. What is verified automatically is that it boots, reloads, and builds the
right event stream.

---

## 2026-10-04 — Parameter contracts, gates, and the live rig's layout

### Done

- Adopted the `metadata: (specs:, frozen:, supplied:)` convention from TTSD and
  SCAestheticRanking. Every argument is in exactly one category, enforced.
- `sc:build` resolves every spec to numbers and emits `<name>.contract.json`; it flows into
  `manifest.json` and is staged into each app, so a page can build its control surface from data.
- `packages/engine/src/contract.ts` — the same warp mapping in TypeScript.
- The live rig, `npm run sc:live`, with contract-driven sliders.
- `docs/SIDECAR.md`.

### Verified

- Web: **909 tests**, 13 e2e. sclang: **39 assertions + 5 continuity**.
- The TypeScript warp mapping is checked against a truth table generated by SuperCollider — ten
  specs × nine positions, exponential, FaderWarp and both curve directions, to six decimals. Then
  broke FaderWarp deliberately and confirmed it fails.
- Nine negative fixtures, one per rule, each proving its check can fire.
- Layout: measured widget bounds across rebuilds rather than judging by eye.

### Findings

**1. The gate was missing, and it mattered twice.** `sendGate = ~sendGate ? ~hasGate`, so without a
gate the event system never releases a note — `\legato` and `\sustain` do nothing and you cannot
hold a note to tune it. Next door, the event system computes `sustain` as a *time*
(`dur * legato * stretch`) and sends it to any argument of that name, so the `sustain` argument was
being silently overwritten by the note length. Renamed to `susLevel`. Both now asserted.

**2. `FlowLayout.remove` is a no-op.** Removing a view does not give its space back, so every
rebuild started where the last ended: measured `0 -> 216 -> 432` across three saves. In a 440px
panel that put the third rebuild off-screen, which is why a newly added control appeared to be
ignored — it was there, below the fold. `decorator.reset` holds it at 0.

**3. The change-detection was unnecessary.** The panel is now rebuilt on every reload. Values live
in the parameter dictionary, not the widgets, so a rebuild keeps the tuning and picks up new
controls. Simpler than the thing it replaced, and it was the thing that was wrong.

**4. `\db` cannot be encoded.** Its minval is `-inf`, which no JSON parser accepts. The encoder
refused it, which is right — but the error named no control, so it is now a contract rule with the
control's name attached.

**5. Replaced `tests/contracts.scd`.** It pinned control *order*, justified by a claim that the
e2e sends controls positionally. That was wrong — OSC addresses controls by name. The metadata
contract catches the failures that are real and drops the one that was not.

### Measurement mistakes worth remembering

Twice I concluded "saving stops the pattern" from counting `postln` lines relative to the reload
line. `postln` flushing does not preserve ordering against other output, so events that did happen
appeared to be absent. Both times the pattern was fine. The continuity test now counts in process.

Separately, the first UGen survey reported a confident 131/131 including a file that cannot load,
because `loadSynthDef` only dispatches `/d_recv` and never waits for a reply.

Both are the same error: measuring the thing that is easy to observe rather than the thing in
question.

### Open

- Domain name, needed at Phase 7.
- CI workflow.
- Phase 5: the React layer, which is where the contract gets consumed in the browser.

---

## 2026-10-04 — Phase 5: the React layer and the UI kit

### Done

- `@ss/engine` gained `createSession`, which bundles boot, node notifications, the dispatcher, the
  buffer allocator and the metrics poller. It was in the playground; it belongs in the engine.
- `@ss/react`: `SuperSonicProvider` plus four external stores and six hooks.
- `@ss/ui`: `BootGate`, `SynthDefControls`, `MetricsPanel`, `OscLog`, `NodeTree`.
- The playground rebuilt on top: a browser over all 133 defs, controls generated from each
  contract, live metrics, an OSC log and the node tree.

### Verified

**921 unit + type tests, 14 e2e.** The playground boots to `sab`, draws **eight sliders for
`ssp_noise` from its contract and no more**, draws **none** for a vendored def while saying why,
plays with no `/fail`, drops no messages, and shows OSC in both directions.

The burst behaviour is asserted rather than assumed: 500 messages into the log store produce **at
most two** listener notifications.

### Findings

**1. The OSC log earned its place within minutes of existing.** It showed
`→ /s_new ssp_noise` immediately followed by `← /fail /s_new SynthDef not found`. Only the defs
named on the provider are loaded at boot, so every def in the browser except `sonic-pi-beep` failed
to play — and the only visible symptom was a note that never sounded. The browser now loads a def
when you select it.

**2. The vendor manifest was mixing filenames with logical names.** `copyNamed` returns filenames,
and the manifest was built from its return value, so vendored entries carried `.scsyndef` while
authored ones did not. The page then requested `<name>.scsyndef.scsyndef`. Fixed to use logical
names throughout, which is what `loadSynthDef` and the URLs actually want.

**3. A def with no contract is the better demonstration.** The 131 vendored defs have names and
defaults in their binaries but no ranges, so the browser shows the values and says there are no
sliders. The contrast with the eight generated sliders beside it makes the case for the contract
better than any amount of prose.

### Open

- Domain name, needed at Phase 7.
- CI workflow.
- Phase 6: audio assertions through `startCapture`/`stopCapture`, which is the last thing standing
  between "it reports success" and "it made the right sound".
