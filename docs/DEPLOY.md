# Deploying

Nothing synthesises audio on the server. A deployed page is static files plus two headers, so the
server's whole job is to serve bytes and not lose the headers on the way.

Step-by-step VM setup is in [`infra/PROVISION.md`](../infra/PROVISION.md). This is the why.

## A subdomain per page, not a subdirectory

`soh.la` is on GitHub Pages; `playground.soh.la` is the Linode VM. The obvious-looking
`soh.la/ssplay` is not available, for two independent reasons.

**DNS maps names to addresses and has no concept of paths.** Whichever machine answers for `soh.la`
decides what `/ssplay` means, so a subdirectory would require the apex itself to move to the VM and
reverse-proxy everything else back — and GitHub Pages cannot proxy, nor set COOP/COEP.

**And `Cross-Origin-Embedder-Policy` applies to an origin, not a path.** Serving the playground at
`soh.la/ssplay` would impose `require-corp` on all of `soh.la`, blocking every cross-origin font,
script, image and embed on the rest of the site. A subdomain is its own origin, so isolation stays
contained to the page that needs it. The constraint that looked like an obstacle is the reason the
design is right.

## Atomic releases

```
/srv/ssplay/playground/20261006-143022/
/srv/ssplay/playground/20261006-151144/
/srv/ssplay/playground/current -> 20261006-151144
```

Upload into a fresh timestamped directory, then move the symlink. A request arriving mid-deploy gets
the old release intact rather than a tree that is half-new — which for this page would mean an
`index.html` referencing hashed assets that do not exist yet.

Unchanged files are hardlinked from the live release with `--link-dest`, so the 3.4 MB engine is one
copy on disk however many releases point at it, and a typical deploy transfers only the hashed
`/assets`. Rollback is pointing the symlink back; Caddy resolves it per request, so there is nothing
to restart.

`current/RELEASE` holds the timestamp and the git commit. The deploy refuses to run on a dirty tree,
because a release that corresponds to no commit cannot be identified afterwards.

## openrsync is not GNU rsync

macOS ships **openrsync, protocol 29**. Several flags that every rsync tutorial uses are absent or
behave differently, and the failure is immediate rather than subtle — so the forbidden list lives in
a comment at the top of [`infra/deploy.mjs`](../infra/deploy.mjs), next to the code it constrains.

Two that are easy to get wrong:

- **`-a` expands to `-rlptgoD`**, and `-g`/`-o` need root. As the `deploy` user it just fails. Use
  `-rlpt`.
- **`--chmod=D755,F644` is rejected.** openrsync accepts `D`/`F` prefixes only on *relative* modes,
  so the literal form is invalid. `Du=rwx,Dgo=rx,Fu=rw,Fgo=r` means the same thing and is accepted
  by both rsyncs.

## Caching

One rule: **never immutable-cache a URL that is not content-addressed.** A year-long `immutable`
response cannot be revalidated or evicted — the only remedy is a new URL, so claiming it for a
stable filename means shipping a bug you cannot fix for your existing visitors.

| Path | Policy | Why |
|---|---|---|
| `/assets/*` | `immutable`, 1 year | Vite puts a content hash in the filename |
| `/vendor/supersonic/**` | `no-cache` | stable filenames, mutable bytes |
| `/`, `/index.html` | `no-cache` | names the hashed assets, so it must never be stale |

`no-cache` does not mean "do not cache" — it means revalidate before use. Caddy's `file_server`
sends `ETag`, so a warm reload gets `304` with an empty body. It costs a round trip, not a download.

The engine *could* honestly be immutable if the SuperSonic version were in its URL
(`/engine/0.88.0/...`), which is what [`PLAN.md`](../PLAN.md) specified. It is not implemented —
`VENDOR_DIR` is a flat `vendor/supersonic` — so the engine revalidates. **Worth doing, not yet
done**; see [LOG.md](LOG.md).

These globs are generated from `infra/headers.json`, and the first version of them matched nothing
at all: they named `/engine/*`, `/synthdefs/*` and `/samples/*` while the build emits everything
under `/vendor/supersonic/`. Dead `Cache-Control` rules are invisible — the site works, slightly
worse, forever. The lesson is in the test: assert against the paths the build actually produces, not
the ones the design intended.

## The header check is the deploy's last step

`npm run deploy` finishes by fetching the live URL and comparing the response against
`infra/headers.json`, exiting non-zero if they differ.

This is the one assertion worth making from outside, because **a dropped header is invisible**.
SuperSonic negotiates its transport silently: without isolation it falls back to `postMessage`, the
page still boots, audio still plays, and only the low-latency path and `startCapture` are gone.
Nothing on screen says so. See [CROSS_ORIGIN.md](CROSS_ORIGIN.md).

## The Caddyfile is installed by hand

`infra/Caddyfile` is generated, but `/etc/caddy/` needs root and the `deploy` user has no sudo —
deliberately, since a deploy credential that can reconfigure the machine is not much of a
restriction. So installing it is a manual step in the console, needed **only when the page list
changes**. [PAGES.md](PAGES.md) has the commands.

Skipping it fails silently, which is the real hazard: a stale Caddyfile once served the landing
page's HTML at every page path, so every link appeared to do nothing and nothing errored. The
post-deploy check exists because of that, and because `npm run verify` cannot see it — the e2e
suite runs against `tools/serve.mjs`, never against Caddy.

## Deploy is local, by decision

`npm run deploy -- --yes`, from your machine, gated on `npm run verify`.

CI does not deploy. This is a **public** repo, so a VM SSH key in Actions secrets would give every
workflow run on the default branch a path to the server, and workflow injection through a
compromised third-party action is a standing risk. The entire deliverable is static files that
upload in a few seconds; the automation would buy nothing and widen the blast radius.
