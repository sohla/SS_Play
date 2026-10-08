# Adding a page

Every page is its own app under `apps/`, served from a path on the one shared origin. There is no
DNS record, no certificate and no new site block — that was the point of putting the pages on one
origin rather than one subdomain each.

There is no bare template — `apps/scratch` was deleted once it had served its purpose. Copy whichever
existing page is the same *shape* as the one you want:

| shape | copy | what it is |
|---|---|---|
| held voice | `apps/gendy` | one synth, controls moved by the phone. The smallest engine page. |
| sequence in the server | `apps/suz` | a Demand clock, `SendReply`, a voice spawned per event |
| sequence in JS | `apps/multibeat` | `ClientConductor` with OSC timetags, for a pattern whose shape changes while it plays |
| sampled | `apps/marimba` | the above plus a buffer set loaded before anything can play |
| layered | `apps/combo` | several `ClientConductor`s on one shared bar, kept in phase by the shell |
| bespoke UI | `apps/touch` | no `MotionInstrument`; its own layout and gestures |

The three instrument shapes are described in
[UI.md](UI.md#the-three-shapes-an-instrument-takes); which one you need is decided by whether the
pattern's *shape* changes at runtime, not by taste.

Whatever the shape, the shell draws AirKit's plotter and a sensitivity control as soon as the page
supplies two things: a `plot` returning the values its mapping reads, and a `map` taking
`(motion, sensitivity)`. Both are in [UI.md](UI.md#the-plotter). A page with no `plot` falls back to
the static bars, which works and shows much less — if a gesture seems to do nothing, the plotter is
the thing that says so.

## 1. Declare it

[`infra/sites.json`](../infra/sites.json) is the single source. Everything else reads from it:

```json
{
  "app": "drone",
  "path": "/drone/",
  "title": "drone",
  "blurb": "One sentence, shown on the landing page.",
  "engine": true
}
```

| | |
|---|---|
| `app` | Directory name under `apps/`, and the npm workspace name |
| `path` | URL prefix, **with both slashes** |
| `title`, `blurb` | What the landing page shows |
| `engine` | `false` for a page that boots nothing — see below |
| `temporary` | Optional. Marks it as disposable on the landing page |

Declaring it here gets you, with nothing further to write: the link on the landing page, the
Caddyfile's cache rules for that path, its place in the assembled build, and a path the e2e specs
can import from `tests/e2e/pages.ts`.

## 2. Create the app

```sh
cp -r apps/gendy apps/drone
rm -rf apps/drone/dist apps/drone/public
```

`public/` is generated — `stageVendor` writes the engine into it on every build — so copying it over
carries a stale vendor tree that the new page's `basePath` does not match.

Then edit four things:

- **`package.json`** — `"name": "@ss/drone"`, and a dev `--port` no other app uses
- **`vite.config.ts`** — `name: 'drone'`, `basePath: '/drone/'`, and a port matching the above
- **`index.html`** — the `<title>`
- **`src/App.tsx`** — the page itself

**`basePath` must equal the `path` in `sites.json`.** Vite joins it onto every asset URL and onto
the engine's base, so a page built for one path and served from another fetches its worklet and wasm
from somewhere that does not exist — which arrives as an opaque boot failure, not a 404 you can see.

Then:

```sh
npm install        # links the new workspace
```

## 3. Build, check, deploy

```sh
npm run infra:gen     # regenerates infra/Caddyfile from sites.json
npm run verify        # typecheck, unit tests, build, e2e against the assembled site
npm run deploy -- --yes
```

`verify` builds every app and assembles them into `dist/`, with the landing page at the root and
each other page under its own path. `deploy` ships that whole tree as one atomic release.

## 4. The server config travels with the release

`npm run infra:gen` regenerates `infra/Caddyfile`, and `npm run deploy` ships it to the VM and
reloads Caddy. No root, no manual step. Caddy validates the config as it loads; if it is rejected,
the deploy fails and the previous config keeps running.

**`caddy reload` needs no privilege.** It posts to the admin API on `localhost:2019`, which Caddy
opens unauthenticated by default. Writing `/etc/caddy/Caddyfile` needs root; *loading* a config does
not. That distinction is the whole reason this is automatic.

### One-time bootstrap — done

**This has been run.** `/etc/caddy/Caddyfile` is now 33 bytes:

```
import /srv/ssplay/caddy/*.caddy
```

so nothing below needs doing again, and nothing in the deploy loop asks for root. Kept because it is
the only part of the setup that cannot be re-derived from the repo, and a rebuilt VM needs it.

Without it, a deploy still corrected the running config — but Caddy re-reads `/etc/caddy/Caddyfile`
when it restarts or the VM reboots, and reverted. For most of this project's life that meant a
reboot would have taken the site back to a single-page config with a site-wide
`try_files {path} /index.html` and no `/samples/` route.

**Only one of the steps needs root**, and an earlier version of this section said all five did — the
same mistake made three times in this project about Caddy and privilege. `/srv/ssplay` is owned by
`deploy`, so the directory and the config are the deploy user's to create over ordinary ssh:

```sh
mkdir -p /srv/ssplay/caddy && chmod 755 /srv/ssplay/caddy
install -m 644 /tmp/ssplay-site.caddy /srv/ssplay/caddy/site.caddy
```

`/tmp/ssplay-site.caddy` is where `deploy.mjs` leaves the config while the persistent directory does
not exist — **not** `/tmp/Caddyfile`, which this section used to name and which is a stale leftover
from an early deploy. Installing that one would pin a config from before the page list grew, with
`try_files {path} /index.html` in it and no `/samples/` route.

Then the single root step, in the LISH console:

```sh
printf 'import /srv/ssplay/caddy/*.caddy\n' > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Validate before reloading. A bad config makes `systemctl reload` a no-op, leaving the previous one
serving — but a `restart` on a bad config takes the site down, so it is worth knowing which you have
before you need it.

After this, `/etc/caddy/Caddyfile` is one line that never changes, and the real config is a file the
deploy owns. `caddy reload` reaches the admin API on `localhost:2019`, which needs no privilege, so
nothing in the loop asks for root again.

### Why this was worth doing

Installing it by hand was needed **whenever the page list changed** — which is exactly the thing
sharing an origin was supposed to make cheap — and skipping it failed silently. A stale Caddyfile
carrying a site-wide `try_files {path} /index.html` once made `/`, `/playground/` and `/scratch/`
return byte-identical HTML. Every link appeared to do nothing, nothing errored, and
`npm run verify` was fully green, because the e2e suite runs against `tools/serve.mjs` and **cannot
see the server actually serving the site**.

`npm run deploy` also fetches every page afterwards and checks it serves its own document, keyed on
that page's own hashed asset path. That check stays regardless: it is what catches the config being
right and the content being wrong, or either one drifting.

## Pages that load samples

A sampled instrument cannot be built until its buffers are loaded, and loading needs a booted
engine — so the order is boot, then load, then build. `MotionInstrument` takes two props for that:

```tsx
<MotionInstrument
  ready={library !== null}
  pending={error ? `Could not load ${error}` : `Loading 10 bars — ${progress.done} of 10.`}
  …
/>
```

`ready` is in the build effect's dependency list. Leave it out and the effect never re-runs, so the
page sits silent with every buffer in place — which looks exactly like a page that works.

The loading itself is `loadSampleSet` from `@ss/engine`, which takes filenames in the shared store
and returns a bufnum, frame count, channel count and sample rate for each. Sequential rather than
parallel: four concurrent decodes of a few megabytes each is a memory spike on the device least able
to absorb one, and a slower boot is visible and survivable where a crash is neither.

See [SAMPLES.md](SAMPLES.md) for the store, the per-page budget, and how to work out which samples a
pattern can actually reach.

## Pages that boot nothing

Set `engine: false` in `sites.json` **and** in `vite.config.ts`. The SuperSonic runtime is 1.8 MB of
wasm before a single SynthDef, and `stageVendor` copies it in unconditionally otherwise — so a page
of links would serve all of it to every visitor. The landing page is the one that does this.

Declaring `synthdefs` or `samples` alongside `engine: false` throws at config time, since nothing
would load them.

## Removing a page

Delete its entry from `sites.json`, delete `apps/<name>/`, then `npm install`, `npm run infra:gen`,
`npm run verify` and deploy. If the page was the only one using a SynthDef, delete that too and
re-run `npm run sc:build && npm run sc:test && npm run sc:promote` — an orphaned def is staged into
every page for nothing.

Samples are *not* removed by this: they live in the store outside the repo, and the next
`npm run samples -- --yes` mirrors whatever is there. Delete the files locally to take them off the
site.

The old release stays on the VM, so a page removed by mistake is one symlink away:

```sh
ssh deploy@playground.soh.la 'ls /srv/ssplay/playground'
```

Three releases are kept. Rolling back is in [DEPLOY.md](DEPLOY.md).
