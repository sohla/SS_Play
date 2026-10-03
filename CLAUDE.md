# CLAUDE.md

Guidance for working in this repo. `PLAN.md` holds the design; `docs/API-0.88.0.md` holds the
library surface; `docs/LOG.md` is the append-only record of what was actually done.

## What this is

Multiple independently deployed web pages running `scsynth` in the browser via SuperSonic.
Entirely client-side — the server only serves static files. An npm-workspaces monorepo: shared
`packages/*`, one app per page, a SuperCollider-side `sidecar` for SynthDefs.

## Invariants

These are the things that break silently if ignored.

**No `setState` from an OSC event handler.** `in`/`out` can fire at audio rate. Use `useOscTap`,
which re-renders nothing. `useOscLog` is the only hook that re-renders, via a ring buffer written
outside React with its version bump coalesced to one `requestAnimationFrame`.

**No third-party subresources on any page.** `Cross-Origin-Embedder-Policy: require-corp` blocks
cross-origin fonts, scripts, images and embeds unless they opt in. Self-host everything. A Google
Fonts `<link>` will silently lose the font, and nobody notices until a Safari user reports it.

**Headers are defined once**, in `infra/headers.json`. The Vite preset imports it; `infra/gen.mjs`
renders the Caddyfile from it. Never write a header literal into a Vite config or the Caddyfile.

**Never call `getMetrics()`.** Its key names and nesting disagree with the shipped typings. Read
`getMetricsArray()` with offsets resolved from `getMetricsSchema()` at runtime. Never hardcode an
offset or an array length — the offsets are not contiguous.

**Never pass `mode` to the SuperSonic constructor.** 0.88 negotiates it from
`crossOriginIsolated`, and forcing it is the only way to reach the throwing capability probe.
Report the achieved mode instead.

**SynthDefs must live at `synthdefs/` relative to SuperSonic's `baseURL`**, not at app root. Wrong
placement fails with an opaque exception.

**Never immutable-cache a URL that isn't content-addressed.** Hash it or revalidate it.

**Don't change what something does while changing how it looks.** SynthDefs, sensor mappings and
tuning are performance-tested artefacts, not scaffolding. Commented-out lines are working notes.
If behaviour needs to change, that's a separate, explicit piece of work.

## Conventions

- Authored SynthDefs are prefixed `ssp_` so they can never collide with the bundled `sonic-pi-*`.
- Internal packages are `@ss/*`, referenced as `"*"`, consumed as TypeScript source. Nothing in
  `packages/` builds; only `apps/` do.
- Never run `npm install` inside a workspace directory — it writes a nested lockfile.
- `sclang` is not on PATH. Scripts resolve it from `$SCLANG`, then
  `/Applications/SuperCollider/SuperCollider.app/Contents/MacOS/sclang`, then `which`.
- `rsync` here is openrsync (protocol 29), not GNU 3.x. The safe flag set is
  `-rlpt --delete --chmod=D755,F644`; the forbidden ones are listed in `infra/deploy.mjs`.

## Code style

Code should tell the story on its own — match the surrounding naming and idiom, and don't narrate
what the code already says. Comments earn their place by explaining a non-obvious *why*: the float
coercion in `ctl()`, the `paths` workaround for the library's broken `exports`, the forbidden rsync
flags. Docs are written for a person reading them cold.

Reports stay short and factual: what was done, what was verified, what is open. When a test
threshold gets relaxed, the comment must give the physical reason — without one, the test is
reporting a real bug.
