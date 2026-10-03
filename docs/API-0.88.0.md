# SuperSonic 0.88.0 — the API we actually build on

Read from the installed package, not from the v0.66.0 copy in
`../supersonic/supersonic/`. **That local drop is a misleading guide** — seven things changed, and
two of them silently invert design decisions.

`packages/engine/test/api-surface.test.ts` and `api-types.test-d.ts` assert everything below, so a
version bump turns into a failing test rather than a debugging session. Update this file whenever
those tests change.

## Shape of the class

`SuperSonic` subclasses the Clockwork host. The chain is two levels deep:

| Level | Members |
|---|---|
| `SuperSonic` | 1 accessor, 16 methods — the scsynth-specific layer |
| Clockwork host | 17 accessors, 48 methods — lifecycle, events, metrics, capture, clock |

**Anything that inspects only `SuperSonic.prototype` sees 16 of ~65 members** and will wrongly
conclude the rest were removed. Walk the chain.

Module exports are exactly `SuperSonic`, `OscChannel`, `osc`.

## The seven changes from 0.66.0

### 1. The package is AGPL-3.0-or-later

0.66.0 was not. This is the client API we `import`, so it is **bundled into each page's JS** —
unlike `supersonic-scsynth-core`, which is fetched at runtime. The deployed bundle is a derivative
work, which is why SS_Play is AGPL-3.0-or-later and every page carries a source link.

### 2. Typings ship — but TypeScript cannot resolve them

`package.json` declares `"types": "supersonic.d.ts"` (2092 lines), yet its `"exports"` map has no
`types` condition. Under `moduleResolution: "bundler"` the `exports` map wins, so the import
degrades to `any` and TS reports:

> There are types at '…/supersonic.d.ts', but this result could not be resolved when respecting
> package.json "exports". The 'supersonic-scsynth' library may need to update its package.json.

**This is an upstream packaging bug.** `tsconfig.base.json` works around it with a single `paths`
entry pointing at the declaration file. Remove that entry once upstream adds the condition. Note
this is unrelated to the internal `@ss/*` packages, which resolve through workspace symlinks and
deliberately have no `paths` entry.

### 3. The transport mode is auto-negotiated

```js
const mode = options.mode || (globalThis.crossOriginIsolated ? 'sab' : 'postMessage')
```

The capability probe still throws (`Missing required features for … mode`), but it is only
reachable by **forcing** `mode`. So `boot()` never passes it.

The consequence that matters: a dropped COOP/COEP header no longer throws — it quietly yields
postMessage, which disables audio capture and turns the e2e audio assertions into assertions about
nothing. That is why the engine reports the achieved mode and the e2e suite **fails hard** when it
is not `sab`.

### 4. The prescheduler and all cancellation are gone

No `cancelTag`, `cancelSession`, `cancelSessionTag`, `cancelAll`. No prescheduler worker, no
`preschedulerCapacity`, no `bypassLookaheadMs`. `sendOSC` lost its options object and is now
`sendOSC(bytes)`. `purge()` is the only flush. Classification and scheduling moved onto the audio
thread.

### 5. The worker set shrank and the worklet was renamed

Two workers now, both in the main package: `dist/workers/osc_in_worker.js` and
`dist/workers/osc_out_log_sab_worker.js`. The worklet moved to the core package and is
`clockwork_audio_worklet.js` — not `scsynth_audio_worklet.js`.

Also in core: `wasm/clockwork_gamepad_bg.wasm` and `wasm/clockwork_midi_bg.wasm`.

### 6. The wasm filename works only by accident

The Clockwork layer defaults `wasmUrl` to `${wasmBaseURL}clockwork-engine.wasm`, **which does not
exist** in `supersonic-scsynth-core@0.88.0`. The SuperSonic layer overrides it to
`scsynth-nrt.wasm`, which does. It works because one layer corrects another's wrong default —
so `resolveEngineUrls` sets `wasmUrl` explicitly and this can never bite.

### 7. Metrics were renamed and restructured

`engineProcessCount`, not `scsynthProcessCount`. The schema has four sections:

| Section | Keyed by | Use |
|---|---|---|
| `metrics` | `offset` | 73 entries, read from `getMetricsArray()` |
| `nativeStats` | `index` | a **separate** array — note it is not `offset` |
| `composites` | — | paired display values |
| `layout.panels` | — | what `<MetricsPanel>` renders from |

73 metrics but a maximum offset of **76** — the offsets are **not contiguous**, so never derive a
length from the count, and never hardcode either.

**Never call `getMetrics()`.** It exists, but its key names and nesting disagree with the shipped
typings. `createMetricsPoller` reads `getMetricsArray()` with offsets resolved from
`getMetricsSchema()` at runtime.

## scsynth world options

Ten flags, extracted from the bundle's own option table:

| Option | Flag | Default | Min | Max |
|---|---|---|---|---|
| `numBuffers` | `-b` | 1024 | 1 | 65535 |
| `maxNodes` | `-n` | **1024** | 1 | 4194304 |
| `maxGraphDefs` | `-d` | 1024 | 1 | 4194304 |
| `maxWireBufs` | `-w` | 64 | 1 | 4194304 |
| `numAudioBusChannels` | `-a` | **1024** (was 128) | 1 | 4194304 |
| `numControlBusChannels` | `-c` | **16384** (was 4096) | 1 | 16777216 |
| `realTimeMemorySize` | `-m` | 8192 | 1 | 4194304 |
| `numRGens` | `-r` | 64 | 1 | 65536 |
| `loadGraphDefs` | `-D` | 0 | 0 | 1 |
| `verbosity` | `-V` | 0 | 0 | 4 |

Gone from 0.66.0's set: `bufLength`, `numInputBusChannels`, `numOutputBusChannels`,
`preferredSampleRate`, `realTime`, `memoryLocking`.

`maxNodes` of 1024 is the one to watch. A SynthDef missing a `doneAction` exhausts it in seconds,
which is why the sidecar asserts `canFreeSynth` at authoring time and why we pin the value
explicitly rather than inheriting it.

## What ships that we must not reimplement

- **`nextNodeId()`** — thread-safe, from 1000. No node-ID allocator needed.
- **`clock`** (`ClockworkClock`) — bpm, beat/time conversion, `now()` on the audio thread.
- **`getEngineState()`** → `'stopped' | 'booting' | 'running' | 'restarting' | 'error'`, plus a
  `'statechange'` event carrying `{state, previous, reason, error?}`.
- **`sampleInfo()`** — decode and SHA-256 without consuming a buffer slot, so `loadSampleOnce` can
  dedupe before loading.
- **`osc`** — the codec, as a **static**. The *instance* `.osc` accessor is the transport. Reaching
  for `sonic.osc.encodeMessage` is the easiest mistake to make against this library.
- **26 typed events**, including `'in': (msg: OscMessage) => void`. `on`/`once` return an
  unsubscribe function; `off` returns the instance — asymmetric, and the disposer bag depends on it.
- **Typed `send` overloads** across the scsynth command surface, plus `AddAction = 0|1|2|3|4`.

## What still needs wrapping

- **`send` infers OSC types**: a JS integer becomes int32, so `send('/n_set', id, 'freq', 440)`
  sends an **int** where every control bus wants a float. `ctl()` inverts this — bare numbers
  become floats, integers need an explicit `i()`.
- **`loadSynthDefs(names)` resolves to `Record<string, {success, error?}>` and never rejects
  per-item.** Nothing throws when a def fails; you have to read the map. Hence
  `loadSynthDefsChecked`.
- **`loadSample` takes a caller-supplied `bufnum`**, validated against `numBuffers`. Hence
  `BufAllocator`.
- **No promise-based reply API except `sync()`.** `/done`, `/fail`, `/n_end`, `/tr` and `SendReply`
  arrive only through `on('in')`. A `request()` method exists at runtime but is **absent from the
  typings**, so treat it as private. Hence the `Dispatcher`.

## Audio capture — SAB mode only

```ts
startCapture(): void
stopCapture(): { sampleRate: number; channels: number; frames: number
                 left: Float32Array; right: Float32Array | null }
isCaptureEnabled(): boolean
getCaptureFrames(): number
getMaxCaptureDuration(): number
```

Real samples out of the engine, which is what lets the e2e suite assert energy, headroom and
spectrum rather than guessing from an analyser node. It needs cross-origin isolation, so the
Playwright-served app must carry the COOP/COEP headers.
