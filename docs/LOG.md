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
