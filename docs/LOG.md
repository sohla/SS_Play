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
