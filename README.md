# SS_Play

Web pages that run SuperCollider's `scsynth` in the browser, built on
[SuperSonic](https://github.com/samaaron/supersonic).

Everything runs client-side: `scsynth` is compiled to WebAssembly and executes in the visitor's
browser as an AudioWorklet. Nothing synthesises audio on the server, so deploying a page means
serving static files — with exactly the right headers, which is the whole trick.

## Layout

| Path | What |
|---|---|
| `packages/engine` | Typed boot and mode reporting, OSC helpers, reply dispatcher, `.scsyndef` parser |
| `packages/react` | Provider, external stores, and hooks |
| `packages/ui` | Tailwind component kit, including contract-generated controls |
| `packages/vite-preset` | The shared app config factory |
| `apps/*` | One app per deployed page |
| `sidecar` | SynthDef authoring: the live rig, headless `sclang` build, assertions, compiled output |
| `infra` | Header source of truth, generated Caddyfile, deploy |
| `docs` | Architecture, cross-origin, synthdefs, testing, deploy, and the work log |

See [`PLAN.md`](PLAN.md) for the full design and [`docs/API-0.88.0.md`](docs/API-0.88.0.md) for the
library surface this is built against.

| Doc | |
|---|---|
| [`docs/UI.md`](docs/UI.md) | The React layer: hooks, re-render rules, generated controls |
| [`docs/SIDECAR.md`](docs/SIDECAR.md) | Authoring SynthDefs: the live rig, and how to use it |
| [`docs/SYNTHDEFS.md`](docs/SYNTHDEFS.md) | The parameter contract, the compile pipeline, the binary format |
| [`docs/CROSS_ORIGIN.md`](docs/CROSS_ORIGIN.md) | Isolation headers, and testing on a phone |
| [`docs/API-0.88.0.md`](docs/API-0.88.0.md) | What SuperSonic 0.88 actually does, where it differs from its typings |
| [`docs/LOG.md`](docs/LOG.md) | What was done, what was verified, what is open |

## Getting started

```sh
nvm use          # 22.19.0
npm install

npm run dev      # the playground, at http://localhost:3000
npm run verify   # the web gate: typecheck, tests, build, e2e
```

Working on sounds rather than pages needs SuperCollider installed:

```sh
npm run sc:live ssp_sine play   # tune a SynthDef by ear, reloading on save
npm run sc:verify               # the SuperCollider gate
```

## Cross-origin isolation

Pages are served with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without both, `SharedArrayBuffer` is unavailable, SuperSonic falls back to its slower postMessage
transport, and audio capture stops working. The header set is defined once in
`infra/headers.json`, consumed by the Vite dev and preview servers and rendered into the Caddyfile
by `infra/gen.mjs`, so the three can't drift apart.

A consequence worth knowing before you add anything to a page: **no third-party subresources.**
`require-corp` blocks cross-origin fonts, scripts and embeds unless they opt in. Self-host instead.

## Licence

AGPL-3.0-or-later. `supersonic-scsynth` is AGPL and is bundled into each page's JavaScript, which
makes a deployed page a derivative work — so the source has to be offered to anyone using it. Every
deployed page links back here.
