# Adding a page

Every page is its own app under `apps/`, served from a path on the one shared origin. There is no
DNS record, no certificate and no new site block — that was the point of putting the pages on one
origin rather than one subdomain each.

Use `apps/scratch` as the template. It is the smallest thing that still boots a real engine.

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
cp -r apps/scratch apps/drone
rm -rf apps/drone/dist apps/drone/public
```

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

### One-time bootstrap

Without this, a deploy still corrects the running config — but Caddy re-reads `/etc/caddy/Caddyfile`
when it restarts or the VM reboots, and reverts. The bootstrap makes the deployed config the one it
re-reads.

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

## Pages that boot nothing

Set `engine: false` in `sites.json` **and** in `vite.config.ts`. The SuperSonic runtime is 1.8 MB of
wasm before a single SynthDef, and `stageVendor` copies it in unconditionally otherwise — so a page
of links would serve all of it to every visitor. The landing page is the one that does this.

Declaring `synthdefs` or `samples` alongside `engine: false` throws at config time, since nothing
would load them.

## Removing a page

Delete its entry from `sites.json`, delete `apps/<name>/`, then `npm install`, `npm run infra:gen`,
`npm run verify` and deploy. `apps/scratch` exists to be deleted this way
once it has served its purpose.

The old release stays on the VM, so a page removed by mistake is one symlink away:

```sh
ssh deploy@playground.soh.la 'ls /srv/ssplay/playground'
```

Three releases are kept. Rolling back is in [DEPLOY.md](DEPLOY.md).
