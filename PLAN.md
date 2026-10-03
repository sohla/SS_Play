# SS_Play — plan and specs

**Location:** `~/Develop/SuperCollider/Projects/SS_Play`

## Context

You have an unpacked SuperSonic **v0.66.0** distribution at
`~/Develop/SuperCollider/Projects/supersonic/supersonic/` — not a git repo, no build system, no
`package.json`. It holds the engine bundle, a WASM scsynth, 5 workers, 131 `.scsyndef` binaries,
207 samples, and one half-edited `simple.html`. The goal is a real project alongside it:
**SS_Play**, a monorepo that builds and deploys several independent web pages each running scsynth
in the browser, with a SuperCollider-side pipeline for authoring and testing SynthDefs, deployed to
a Linode VM.

The fact that shapes the whole design: **SuperSonic is entirely client-side.** scsynth is compiled
to WASM and runs in the visitor's browser as an AudioWorklet. Nothing synthesises audio on the
server. "Deploying" means serving static files with exactly the right headers — which is why a
Linode VM beats a static host here: GitHub Pages cannot set COOP/COEP, and without those,
SuperSonic's low-latency SharedArrayBuffer transport is unavailable.

Prior art worth inheriting: `~/Develop/Web/Projects/moovit` is a TS + Vite SuperSonic project of
yours whose `LESSONS_LEARNED.md` records two things this plan is built around — SynthDefs must sit
at `synthdefs/` *relative to SuperSonic's `baseURL`* (wrong placement gives an opaque "unknown
exception"), and its COOP/COEP headers are commented out in dev with the note "temporarily disabled
for basic audio functionality". That second one is the cross-origin problem you asked to deal with
properly this time.

## Decisions taken

| | |
|---|---|
| Shape | npm-workspaces monorepo: shared `packages/*`, one app per deployed page |
| Stack | TypeScript, React 19, Tailwind 4, Vite 8 |
| SuperSonic | npm, pinned exact to **0.88.0** (four packages) |
| Transport | SAB-first — **mostly upstream now**; we report the achieved mode and gate on it |
| Sidecar | batch build + test CLI, headless sclang, no live reload |
| Repo | **public** `sohla/SS_Play`, licensed **AGPL-3.0-or-later** |
| Samples | npm package, per-app declaration, content-hashed at build |
| Browser tests | Playwright driving your installed Chrome 154 (`channel: 'chrome'`) |
| Deploy | Linode + Caddy, subdomain per page, manual `deploy.mjs`; **CI never deploys** |
| v1 scope | `apps/playground` only — no musical content until the plumbing is proven |

**Open input:** the domain name. Phases 0–6 proceed without it; `infra/` carries a `DOMAIN`
placeholder and Phase 7 blocks until you name it.

## Verified facts

I read the real 0.88.0 tarball rather than trusting the 0.66.0 copy on disk. **The local bundle is
a misleading guide — seven things changed.**

**Confirmed from `supersonic-scsynth@0.88.0`'s own `package.json` and bundle:**

- **`license: "AGPL-3.0-or-later"`.** This is the client API you `import`, so it is *bundled into
  each page's JS* — unlike the core, which is runtime-fetched. The deployed bundle is a derivative
  work, hence SS_Play is AGPL-3.0-or-later.
- **Typings ship**: `"types": "supersonic.d.ts"`. **Do not hand-write a type surface.**
- **Mode is auto-negotiated**: `e.mode || (globalThis.crossOriginIsolated ? "sab" : "postMessage")`.
  The capability probe still throws, but only reachable by *forcing* `mode`. So: never pass `mode`.
  A dropped header now silently degrades to postMessage rather than throwing — which makes *loudly
  reporting the achieved mode* the critical safeguard.
- **Two workers, not four**: `dist/workers/osc_in_worker.js` and
  `dist/workers/osc_out_log_sab_worker.js`. The prescheduler and debug workers are gone.
- **The worklet moved and was renamed**: `${coreBaseURL}workers/clockwork_audio_worklet.js`.
- **`wasmUrl`'s base default is `clockwork-engine.wasm`, which does not exist** in the core package;
  the SuperSonic layer overrides it to `scsynth-nrt.wasm`. It works by one layer correcting
  another's wrong default — **set `wasmUrl` explicitly** so this can never bite.
- **Gone**: the prescheduler, `cancelTag`/`cancelSession`/`cancelAll`, `sendOSC`'s options object
  (now `sendOSC(bytes)`), `preschedulerCapacity`, `bypassLookaheadMs`. `purge()` is the only flush.
- **New, so don't reimplement**: `nextNodeId()` (thread-safe, from 1000), `clock` (a full
  bpm/beat/NTP timeline), `getEngineState()` plus a `'statechange'` event, `sampleInfo()` for
  hash-before-load dedupe, and gamepad/MIDI subsystems.
- **Metrics renamed**: `engineProcessCount`, not `scsynthProcessCount`. The shipped `.d.ts` and the
  runtime schema disagree on key names and nesting. **Consume `getMetricsArray()` with offsets
  resolved at runtime from `SuperSonic.getMetricsSchema()`. Never `getMetrics()`, never a hardcoded
  offset or array length.**

**Still true from the 0.66.0 reading:** `send(address, ...args)` is variadic and synchronous, and
infers OSC types — a JS integer becomes int32, so `send('/n_set', id, 'freq', 440)` sends an
**int** where scsynth control buses want a float. `sync()` is the only promise round trip.
`/done`, `/fail`, `/n_end`, `/tr`, `SendReply` arrive only via `on('in', msg => …)`.
`loadSynthDefs()` returns a result map and **does not reject per-item**. `loadSample` needs a
caller-supplied bufnum. `startCapture()`/`stopCapture()` are **SAB-only** and return real
`Float32Array` audio — the audio-assertion mechanism. `on()` returns an unsubscribe.
`SuperSonic.osc` is the codec; the *instance* `.osc` is the transport.

**`.scsyndef` format** — I wrote a parser and validated it against all 131 local files:
**131/131 parse with byte-exact consumption**, every embedded name matches its filename. Three
versions exist in the wild: v1 (int16 counts), v2 (int32), v3 (v2 plus an int32 per-def length
prefix). Those files use **116 distinct UGen classes**, including `MdaPiano` (sc3-plugins) — so the
WASM build is *not* core-UGens-only and any UGen whitelist must be empirical.

**Environment:** Node 22.19.0 / npm 11.6.0, no pnpm/yarn. `gh` authed as `sohla` (scopes lack
`admin:public_key`). SuperCollider **3.14.0** at
`/Applications/SuperCollider/SuperCollider.app/Contents/MacOS/sclang`, **not on PATH**. `rsync` is
**openrsync, protocol 29** — not GNU 3.x. **No SSH keypair exists.** `git init.defaultBranch`
unset. Disk **88% full, 51 GiB free**. Latest toolchain: Vite 8.3.2, Vitest 5.0.3, React 19.3.0,
Tailwind 4.3.3 — but **pin TypeScript 5.9.3, not 7.0.2** (7 is the Go rewrite; one new stack at a
time).

## Layout

```
SS_Play/
├── packages/
│   ├── engine/        boot + mode reporting, ctl(), dispatcher, buffers, metrics, scsyndef parser
│   ├── react/         provider + external-store hooks
│   ├── ui/            Tailwind component kit
│   └── vite-preset/   the shared config factory
├── apps/playground/
├── sidecar/           .scd sources, hermetic sclang build, assertions, committed dist/
├── infra/             headers.json, gen.mjs, Caddyfile, deploy.mjs, PROVISION.md
├── tools/
├── docs/              ARCHITECTURE, CROSS_ORIGIN, SYNTHDEFS, TESTING, DEPLOY, LOG
├── LICENSE            AGPL-3.0-or-later
└── CLAUDE.md
```

**Workspace mechanics.** Internal deps use `"@ss/engine": "*"` (not `workspace:*` — that's pnpm
semantics and npm's failure mode is a confusing `EUNSUPPORTEDPROTOCOL`). `packages/*` are consumed
**as TypeScript source** via `"exports": { ".": "./src/index.ts" }`; Vite transpiles them, nothing
builds. So TS **project references buy nothing** (they need emitted `.d.ts` and fight `noEmit`),
and **`paths` aliases buy nothing either** (two mappings to keep in sync). The `node_modules`
symlink is the single resolution mechanism both TS and Vite already follow. Typecheck is one root
`tsc --noEmit -p tsconfig.typecheck.json`.

`.npmrc`: `save-exact=true` (a caret could move metric key names under you), `engine-strict=true`,
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (≈1 GB of pure waste given `channel: 'chrome'`).

Root `overrides` pin `react`/`react-dom` exactly — `packages/react` and `packages/ui` declare React
as peer+dev, apps as a real dep, and any divergence nests a second React and yields "Invalid hook
call" with a useless stack.

Tailwind 4 is CSS-first: `@tailwindcss/vite`, no `tailwind.config.js`, theme in CSS via `@theme`.
**Monorepo gotcha:** classes inside `packages/ui` are invisible to content detection unless each
app's CSS adds `@source "../../packages/ui/src"`. Miss it and components render unstyled, silently.

**One Vite factory**, `defineSSApp({ name, synthdefs, samples })`, owning the COOP/COEP headers,
the vendor copy, asset hashing and `optimizeDeps` identically for every app. Per-app configs
declare only which assets that page needs — which is also what keeps bundles small instead of every
page shipping 35 MB of samples. The factory **errors if `samples.length > 32`**.

## Phases

Each ends at something runnable.

**Phase 0 — Pin the API.** Deliverable is two permanent tests, not a document:
`api-surface.test.ts` snapshots sorted `Object.getOwnPropertyNames(SuperSonic.prototype)`, statics,
accessors and `getMetricsSchema()` keys; `api-types.test-d.ts` uses `expectTypeOf` to assert the
facts the engine leans on (that `send` takes `{type:'float',value}`, that `on('in',cb)` returns
`() => void`, that `stopCapture()` returns `{left: Float32Array}`). A library bump then becomes a
failing test, not a mystery. Also verify the `scsynthOptions` defaults and **set `maxNodes`
explicitly** whatever they are. Write `docs/API-0.88.0.md`. *No engine code yet.*

**Phase 1 — Repo, workspaces, headers.** Ends when `npm run dev -w apps/playground` serves a page
whose entire content is `crossOriginIsolated: true / SharedArrayBuffer: function`, all workspaces
build, and `npm run infra:gen && git diff --exit-code` is clean. **No SuperSonic yet** — prove the
plumbing with nothing interesting in it, and absorb the Vite 8 / Tailwind 4 novelty here.
**Headers go on in dev from this phase**, never "temporarily disabled".

**Phase 2 — `packages/engine` + Tier 1 tests.** Pure logic against a faked SuperSonic. Green with
no browser.

**Phase 3 — First real boot.** Playground gets a boot button. Ends when clicking yields
`mode === 'sab'`, `getInfo()` on screen, `/s_new` on `sonic-pi-beep` makes audible sound, and
`engineProcessCount` is climbing. First contact with the vendor-copy logic and with COOP/COEP
mattering for real.

**Phase 4 — Parser + sidecar.** Ends when `sc:build && sc:test && sc:manifest` is green and the
Tier 2 suite parses the npm corpus plus your own defs with byte-exact consumption.

**Phase 5 — React + UI.** Ends with a 10 Hz metrics panel, a non-dropping OSC log, and
manifest-generated param sliders, with DevTools showing no re-render storm while OSC flows.

**Phase 6 — Playwright + capture.** Ends when `npm run test:e2e` proves sound for three defs.

**Phase 7 — First deployed page.** One subdomain, real TLS. Ends when `curl -I` shows the right
headers and the e2e smoke spec passes against the live URL.

**Phase 8 — Second page.** The phase that actually validates the monorepo decision. Don't skip it,
or the factory ships with one page's assumptions baked in.

## `packages/engine`

Much smaller than it would have been, because typings, `nextNodeId()`, a typed event map, a typed
`send` and `clock` all ship. **Re-export rather than reimplement** — every wrapper is a thing that
can drift.

Earns its place:

- **`resolveEngineUrls(base)`** — sets `baseURL`, `coreBaseURL`, `workerBaseURL`, `wasmBaseURL`,
  `wasmUrl`, `workletUrl`, `synthdefBaseURL`, `sampleBaseURL` **all explicitly**. One pure, fully
  tested function, so a renamed worklet or wasm file is a one-line fix instead of an opaque boot
  failure.
- **`probe()` / `boot()`** — never passes `mode`. Reports the achieved mode and a `degraded` reason.
  Because a dropped header now degrades silently, one bounded retry handles *non*-capability init
  rejections (SAB allocation failure, a worker 404): `destroy()`, reconstruct as `postMessage`,
  retry **exactly once**, preserve the original as `cause`. Never loop. `probe()` is callable before
  any gesture so the UI shows degradation on load, not after a click.
- **`ctl()` with the default inverted** — bare numbers become **floats**, integers need an explicit
  `i()`. Every SynthDef control bus is a float, so this makes the common case correct by default and
  the rare case (bufnum, a node id in a control slot) explicit. `ctl({freq: 440, bufnum: i(7)})`.
- **`Dispatcher`** — exactly **one** `on('in')` subscription for the whole app, `Map<address, Set>`
  routing, and three helpers: `waitForDone(cmd)` (resolves `/done`, rejects `/fail`),
  `waitForNodeEnd(id)` — **the Playwright synchronisation primitive**, without which audio tests
  become sleep-based and flaky — and `onTrigger()`. Every promise helper takes a mandatory timeout;
  every subscription lands in a disposer bag drained on shutdown.
- **`BufAllocator(numBuffers)`** — free list with `alloc`, `allocN` (contiguous, multichannel),
  `free`, `reserve`. Plus `loadSampleOnce(url)` using `sampleInfo()` to hash before loading and
  reuse a matching bufnum.
- **`parseSynthDefFile(bytes)`** — the v1/v2/v3 parser. Lives here because the sidecar (Node), Tier
  2 (Node) and the UI (browser) all need it. Must **report bytes consumed** (the property that gave
  131/131 confidence and catches a truncated copy) and throw a *typed* error with a byte offset, not
  a bare `RangeError`.
- **`createMetricsPoller`** — `getMetricsArray()` with offsets resolved at runtime from the schema,
  honouring `signed`/`type`/`values` and the `HEADROOM_UNSET` sentinel. One interval, fan-out to N
  subscribers, starts on first subscriber and stops on last.
- **`loadSynthDefsChecked(names)`** — inspects the result map and throws an aggregate naming every
  failure, and resolves logical names through the content-hash manifest to full hashed paths.

Rejected: a node-ID allocator (`nextNodeId()` ships), a type surface (ships), an OSC codec (ships),
tag/session cancellation (gone), a tempo layer (`clock` ships), a pattern system (a page's job).

## React layer

Provider holds the engine in a ref and **never boots on mount** — boot needs a user gesture. The
context value is created once so the context itself never re-renders. Everything observable flows
through **`useSyncExternalStore`**, which matches the library's subscribe/unsubscribe contract
exactly and is tearing-free under React 19.

Four stores: `statusStore` (from `'statechange'`/`'ready'`/`'error'`, a frozen object replaced only
on real change); `metricsStore` (one 10 Hz poller writing a **single reused mutable object** plus a
monotonic `version`; `getSnapshot()` returns the *version number*, so there is zero allocation per
tick and still-correct invalidation); `treeStore` (2 Hz, gated on `tree.version`); `synthDefStore`
(static, from the build manifest).

High-rate OSC gets two deliberately different APIs: **`useOscTap(address, cb)`** re-renders
*nothing* and is the default — drive a canvas or a ref-written node. **`useOscLog({capacity, maxHz})`**
is the only thing that re-renders, via a preallocated ring buffer written outside React and a
version bump coalesced to one `requestAnimationFrame` and throttled to `maxHz`. A 2000 msg/s burst
becomes 10 re-renders/s of one component.

**The invariant, written into CLAUDE.md: no hook may call `setState` from an OSC event handler.**

`packages/ui`: `<BootGate>` (gesture, degraded banner, error state — every page needs exactly this
and none should write it twice), `<MetricsPanel>` (renders from the schema's layout so it adapts to
a library bump), `<OscLog>`, `<SynthDefControls>` (sliders generated from parsed params — the
parser's payoff), `<NodeTree>`, `<Transport>` over `clock`, and the footer carrying the AGPL source
link.

## Cross-origin

Required on the document response only:
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.

**Pick `require-corp`, and host every byte same-origin.** `credentialless` is looser but
**Safari supports only `require-corp`**, and the thing `credentialless` buys is something this
architecture designs itself out of needing. Keep it documented as the escape hatch for a page that
must embed a third-party widget, accepting that such a page loses Safari.

**Definitively: same-origin subresources do not need CORP.** CORP is consulted only for
*cross-origin* loads, so the vendored wasm, workers and worklet need no extra header — Caddy should
not set one. Two corollaries: the library contains a cross-origin worker shim (fetch the script,
wrap in a Blob, create the Worker from a blob URL) that only triggers for cross-origin URLs and
needs CORS, not CORP; and this is precisely why the shared engine must **not** live on a separate
subdomain, which would drag in CORS, CORP, the blob-worker path and a second cert.

**Hard rule, in CLAUDE.md: no third-party subresources on any SS_Play page.** Fonts get
self-hosted. A Google Fonts `<link>` gets blocked by COEP, the page loses its font, and nobody
notices until Safari users report it. Enforced by an e2e assertion of zero cross-origin requests.

Anti-drift, four layers, because any one alone drifts: `infra/headers.json` is the single source of
truth; the Vite preset imports it for both `server.headers` and `preview.headers` with no literal
header string anywhere; `infra/gen.mjs` renders the Caddy snippet from the same file and CI runs
`infra:gen && git diff --exit-code` so a hand-edited Caddyfile fails the build; and one conformance
spec runs against both `localhost:4173` and the deployed URL.

**HTTPS locally is not needed** — `http://localhost` is already a secure context and
`crossOriginIsolated` goes true as soon as the headers are present. mkcert earns its place for
exactly one job: testing on a physical device over LAN, where iOS needs a trusted chain. Opt-in via
`npm run dev:lan`; default `npm run dev` stays HTTP.

## Testing

**Tier 1 — Vitest unit**, `node` env (jsdom only for React and the API-surface dump). The `ctl`
coercion table including every throw case; the dispatcher against a fake emitter, asserting
**listener counts return to baseline**; `BufAllocator` exhaustion and double-free;
`resolveEngineUrls` across every option combination; the boot machine against a SuperSonic that
rejects `init()` once, asserting **exactly one** retry and a preserved `cause`; the metrics poller
tolerating unknown keys and not hardcoding length; the single-React-instance check.

**Tier 2 — binary contract**, Node, no browser, no SuperCollider. Parses both corpora: your
`sidecar/dist/*.scsyndef` and the npm synthdefs package (your best adversarial set — it contains
all three format versions). Per file: parse succeeds, **bytes consumed === file length**, embedded
name === filename stem, param indices are exactly `0..n-1`, `ugens.length > 0`. Across the corpus:
names unique, committed `sha256` matches disk, manifest matches a fresh parse. Plus a property
test that truncating at a random offset throws a *typed* error with a byte offset — that is the
"unknown exception" class of bug, caught. Include the extremes: `sonic-pi-fx_vowel` (164 UGens),
`sonic-pi-mono_player` (99 params), the `fft_*` defs.

**Tier 3 — Playwright + installed Chrome.** `channel: 'chrome'`, `workers: 1` (one AudioContext per
machine), `webServer` running `vite preview` so `preview.headers` supplies COOP/COEP — non-negotiable
because capture is SAB-only. Assert as a **precondition**, not an assumption: `crossOriginIsolated`
is true, `typeof SharedArrayBuffer === 'function'`, and after boot `mode === 'sab'`. **That last
assertion inverts the degradation**: users get graceful fallback, you get a hard build failure. It
is the most valuable test in the repo, because a dropped header is invisible by every other means.

Launch args: only `--mute-audio` (which mutes the *device*; capture taps the worklet upstream).
Deliberately **not** `--autoplay-policy=no-user-gesture-required` — the test clicks a real button,
because the gesture path is what users hit.

Five rules that kill flakiness:
1. **Synchronise on OSC, never on time** — `sync()` before, `waitForNodeEnd(id)` after. The only
   legitimate wait is "let it sound", driven by polling `getCaptureFrames()`, not a sleep.
2. **Analyse in `page.evaluate`, return scalars** — 24,000+ floats over CDP is slow and sometimes
   truncates. Return `{frames, rms, peak, magAtF0, magAtOffF0}`.
3. **Trim to the middle 60%** — the edges are attack and release ramps.
4. **Three independent, generously-thresholded assertions**: energy (`rms > 0.01`, `< 1.0`),
   headroom (`peak > 0.05`, `< 0.99`), and **spectrum** — a ~15-line Goertzel at the def's `freq`
   is `>= 10×` the magnitude at `freq * 1.5`. The third catches "made *a* sound" vs "made *the
   right* sound", i.e. a wrong default or param-order bug producing noise instead of a sine.
5. **Never assert exact values** — not samples, not frame counts (allow ±256), not RMS.

Process rule: **relaxing a threshold requires a comment giving the physical reason.** If there
isn't one, the test is reporting a real bug.

Also Tier 3: the headers conformance spec, zero-cross-origin-requests, `content-type:
application/wasm` on the wasm URL (wrong MIME breaks streaming compile and looks like a generic
boot failure), and `engineProcessCount` strictly increasing across two reads 200 ms apart.

Three defs minimum: a sine (clean spectral assertion), a sample player (exercises `loadSample`,
`BufAllocator`, and the browser's FLAC decode), and an FX def with an input (bus routing).

**CI runs** typecheck, lint, Tier 1, Tier 2, all builds, and the `infra:gen` diff check. **It does
not run Tier 3** (a clean runner has no Chrome channel, and capture thresholds on shared hardware
are a flake factory) and **does not run sclang** (no SuperCollider on the runner — which is exactly
why `sidecar/dist/` is committed).

## Sidecar

```
sclang -l sidecar/conf/sclang_conf.yaml -a -d "$REPO/sidecar" sidecar/build.scd < /dev/null
```

Every flag doing a job. `-l` with a project-local config is the hermeticity fix: your global
`sclang_conf.yaml` injects 7 quarks, and a build inheriting them breaks when you install or remove
one. The config is `includePaths: []`, `excludePaths: []`, `postInlineWarnings: false`.

**But `-a` alone would break everything, and this is the subtle part.** I checked your cloned SC
source: `setExcludeDefaultPaths(true)` calls `mDefaultClassLibraryDirectories.clear()`
(`lang/LangSource/SC_LanguageConfig.cpp:54`), which drops **`SCClassLibrary` itself** along with
the extension dirs. So if `-a` is used, `SCClassLibrary` must be named back explicitly in
`includePaths`. Verify which form compiles on the first run and commit whichever works — this is a
10-minute check that otherwise costs an afternoon.

`-d` keeps anything sclang writes inside the sidecar, not your home. **`< /dev/null`** is required:
sclang's stdin is an interactive REPL and without EOF a batch run hangs forever. Pair with explicit
`0.exit` / `1.exit`. Not `-D` (daemon, wrong for batch), not `-r`/`-s` (a more fragile mechanism
than putting the code in the file).

`bin/sc.mjs` resolves sclang from `$SCLANG`, then the absolute app path, then `which`, failing with
one actionable line. It records `sclang -v` into `sc-version.txt` so a byte-diff in the output can
be attributed to a SuperCollider upgrade.

**No `UnitTest`**, following your `SCAestheticRanking/sc/authoring/` precedent and for its stated
reason: UnitTest needs a class file installed into `Extensions/`, which this project has no
business writing to — and which would defeat the hermeticity just established. Instead: a `check`
closure, `~`-prefixed env vars, `SSP_TEST pass|FAIL <name>` lines, an `SSP_TEST_DONE n passed m
failed` summary, and an exit code `bin/sc.mjs` parses and propagates.

Assertions run **without booting a server** — `SynthDef(...).add` registers into
`SynthDescLib.global` language-side. Assert on the descriptor: `controlNames` is exactly the
expected ordered list (catches an arg reorder that silently breaks positional callers); defaults
match; `hasGate` where expected; **`canFreeSynth` is true** — a def that never frees is the most
common SynthDef bug and manifests in the browser as node exhaustion thirty seconds in; `outputs`
channel count matches the page's expectation; and every authored def is prefixed `ssp_` so it can
never collide with the 130 `sonic-pi-*` defs.

Pipeline: `sc:build` → `out/`, `sc:test` → `SSP_TEST` lines, `sc:manifest` → `{name, params,
ugenCount, bytes, sha256}`, then diff `out/` against `dist/` and fail unless `--update`.

**`sidecar/dist/` is committed.** 131 defs is 656 KB, and it means the web build never needs
SuperCollider, CI runs on a clean runner, Tier 2 has a stable target, and a synthdef change shows
up as a reviewable `sha256` diff instead of a silent rebuild.

## Deployment

Caddy, subdomain per page, generated from `infra/headers.json` + `infra/sites.json`. On disk:

```
/srv/ssplay/_engine/0.88.0/        rsynced once
/srv/ssplay/<page>/<timestamp>/    a release
/srv/ssplay/<page>/current -> <timestamp>
```

The engine is **hardlinked** into each release (`cp -al`), not copied and not served from a
separate origin: one inode per file instead of 1.8 MB per page per release, and — the real reason —
every engine request stays **same-origin**, so COEP needs no CORP and the blob-worker path is never
taken. Deploys are atomic: rsync into a fresh dir, hardlink, `ln -sfn … current`. Keep 3 releases.

**Caching, with one rule: never immutable-cache a URL that isn't content-addressed.**
`/assets/**` (Vite-hashed) and `/engine/<version>/**` (version in path) are honestly immutable.
`/synthdefs/beep.scsyndef` is **not** — stable name, mutable bytes. So content-hash synthdef and
sample filenames at build (`beep.<sha8>.scsyndef`) and emit a revalidated
`/synthdefs/manifest.json` mapping logical name → hashed path. 0.88.0 fetches a string containing
`/` as a path rather than joining it to `synthdefBaseURL`, which is what makes this work. Twenty
lines in the Vite plugin, and the entire stale-asset bug class disappears.

**openrsync-safe** (`protocol 29`): `rsync -rlpt --delete --chmod=D755,F644`. Avoid `-a`
(expands to `-rlptgoD`; `-g`/`-o` need root and fail as the deploy user), `--info=progress2`,
`--delete-delay`, `--mkpath` (hence a separate `ssh mkdir -p`), `--chown`, and zstd — all GNU-only.
Document the forbidden list in a comment in `deploy.mjs`. Dry-run by default; refuses to run on a
dirty tree or without `npm run verify`.

Provisioning (`infra/PROVISION.md`, interactive): `ssh-keygen -t ed25519` **with a passphrase** —
no keypair exists — and paste the public key into Linode's create form so there's never a
password-auth window. **DNS before Caddy**: Caddy attempts ACME the moment a site block loads, and
without resolution it retries and burns your per-name weekly Let's Encrypt quota, which locks you
out for days. `dig +short <sub>` every subdomain first, add them one at a time, and use the ACME
**staging** endpoint for the first end-to-end before switching to production. Then the `deploy`
user, key-only SSH (verify in a second terminal before closing the first), `ufw`, Caddy from the
official apt repo, `caddy validate` on the VM since Caddy isn't installed locally.

**CI does not deploy — a decision, not a limitation.** Mechanically `gh`'s token lacks
`admin:public_key`, but the real reason is that this is a **public** repo: putting a VM SSH key in
Actions secrets gives every workflow run on the default branch a path to your server, and
workflow-injection via a compromised third-party action is a standing risk for a project whose
entire deliverable is static files you can push in four seconds. Deploy is
`npm run deploy -- --page playground --yes`, locally, gated on `verify`.

## Ranked risks

| # | Risk | Early warning | Mitigation |
|---|---|---|---|
| 1 | **Further 0.88 API surprises.** Seven breaking changes already found; `clock`/gamepad/MIDI are wholly new. | You write a wrapper and find the library already does it; a runtime key the `.d.ts` promised is absent. | Phase 0's two permanent tests. Pin exact. Re-export over reimplement. **When `.d.ts` and runtime disagree, runtime wins** — hence `getMetricsArray()` + runtime schema, never `getMetrics()`. |
| 2 | **A dropped header silently degrades to postMessage**, killing capture — and 0.88's auto-negotiation makes this *quieter*, not louder. Audio tests go from proving sound to proving nothing. | `frames: 0` from `stopCapture()`; a test that passes after you relaxed a threshold. | The four-layer anti-drift scheme, plus Tier 3 **failing hard** when `mode !== 'sab'`. Headers on in dev from Phase 1. |
| 3 | **AGPL reach.** The bundled client API is AGPL, so the deployed bundle is a derivative work. | A dependency with an incompatible licence; a page shipping without a source link. | SS_Play is AGPL-3.0-or-later; `LICENSE` lands in Phase 1. Source link in the shared `@ss/ui` footer so no page can omit it, with an e2e assertion that it resolves. Verify `@thi.ng/malloc` (Apache-2.0, compatible) rather than assume. |
| 4 | **Node exhaustion** from a def missing `doneAction`, against whatever `maxNodes` default 0.88 sets. | `/fail` on `/s_new`; `getTree().nodeCount` climbing monotonically. | The sidecar's `canFreeSynth` assertion catches the cause at authoring time. Set `maxNodes` explicitly. An e2e test spawning and freeing 200 synths and asserting nodeCount returns to baseline. |
| 5 | **Disk** — 51 GiB free at 88%, samples are 35 MB and get copied per app per release. | `npm ci` slowing; `df -h` under 20 GiB. | Per-app sample declarations capped at 32; `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`; a `clean` script; prune to 3 releases on the VM. |
| 6 | **Flaky audio tests** get retried, then skipped, and you lose your only real verification. | Any threshold relaxed; any `waitForTimeout` added; `retries` raised. | The five rules above; `workers: 1`; and the process rule that relaxing a threshold needs a stated physical reason. |
| 7 | **Two Reacts** from workspace hoisting. | More than one `react` dir under `node_modules`; hooks failing only in `@ss/ui` components. | Root `overrides`; peer+dev in packages, real dep only in apps; a Tier 1 single-realpath assertion. Never `npm install` inside a workspace dir. |
| 8 | **Sidecar non-hermeticity** — 7 global quarks leak in, or `-a` drops `SCClassLibrary`. | `sha256` changes with no `.scd` diff; a build that works only on your machine. | Project-local config, `sc-version.txt`, the `sha256` diff gate. Settle the `-a` + `SCClassLibrary` question on first run. |
| 9 | **Toolchain novelty** — Vite 8 + Tailwind 4 + Vitest 5 at once, against a Vite 5 / Tailwind 3 precedent. | Peer warnings; a Tailwind class that doesn't generate. | **Pin TS 5.9.3, not 7.** Phase 1 exists to absorb this with nothing interesting at stake. `.nvmrc` + `engine-strict`. |
| 10 | **Let's Encrypt lockout** from starting Caddy before DNS resolves. | Repeated ACME failures in `journalctl -u caddy`. | `dig` first, one subdomain at a time, staging endpoint for the first run. |
| 11 | **Leaked `on('in')` listener** on a high-rate address degrades the page over minutes. | Frame rate decaying; heap climbing; `oscInMessagesReceived` growing without visible work. | One dispatcher subscription total; disposer bag; Tier 1 baseline assertions; a dev-only listener-count readout in the playground. |

## Working agreements

- `docs/LOG.md` is append-only: what changed, what was verified, what's open. One dated entry per
  session.
- Code carries its own story — no decorative comments. Comments are for non-obvious *why* (the
  float coercion, the `-a` hermeticity question, the forbidden rsync flags).
- Reports stay short and factual: done, verified, open.
- Nothing in `sidecar/synthdefs/` or any SynthDef is touched by a presentation-layer task.
