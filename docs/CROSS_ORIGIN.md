# Cross-origin isolation

## Why this matters more than it looks

`SharedArrayBuffer` is only available to a cross-origin isolated page. SuperSonic's fast transport
needs it, and `startCapture()` — the only way to get real audio samples back out of the engine —
works in that mode and no other. So the entire audio verification strategy rests on two response
headers being right.

The trap is that getting them wrong is **silent**. SuperSonic 0.88 derives its own transport mode:

```js
const mode = options.mode || (globalThis.crossOriginIsolated ? 'sab' : 'postMessage')
```

Nothing throws. A page with a dropped header still boots, still makes sound, and still passes a
casual look — it is just slower, and `stopCapture()` returns nothing, which quietly turns every
audio assertion into an assertion about nothing.

That is the failure this setup is built to make impossible to ship.

## The headers

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

On the document response. Defined once, in [`infra/headers.json`](../infra/headers.json).

## Four layers of anti-drift

No single mechanism is enough — each catches a different mistake.

| Layer | Catches | Where |
|---|---|---|
| One source file | Divergent literals | `infra/headers.json` |
| Unit test | The Vite preset not matching the source, or dev and preview disagreeing | `packages/vite-preset/test/preset.test.ts` |
| Generator check | A hand-edited or stale Caddyfile | `npm run infra:check` |
| Browser conformance | Headers present but isolation not actually granted | `tests/e2e/isolation.spec.ts` |

The Vite preset imports `headers.json` for both `server.headers` and `preview.headers`. There is no
header string literal anywhere in a Vite config. `infra/gen.mjs` renders the Caddyfile from the same
file, and `--check` fails if the committed output is out of date.

`infra:check` compares the generated text against the file's own contents rather than asking git,
because a `git diff` gate silently passes whenever the Caddyfile happens to be untracked — which
is exactly what happened the first time this was tested.

All four were verified by deliberately deleting `Cross-Origin-Embedder-Policy` from
`headers.json`: the unit test failed, `infra:check` exited 1, and two e2e tests failed.

## require-corp, not credentialless

`require-corp` demands that every cross-origin subresource opt in, either with
`Cross-Origin-Resource-Policy` or by being CORS-fetched. `credentialless` instead fetches
cross-origin no-cors subresources without credentials, so they need no opt-in.

**We use `require-corp`.** Two reasons: it is the stronger guarantee, and **Safari supports only
`require-corp`**. What `credentialless` buys is tolerance for third-party resources — which this
architecture deliberately has no need for, since everything is self-hosted.

Keep `credentialless` in mind as the escape hatch if a page ever genuinely must embed a third-party
widget, and accept that such a page loses Safari.

## The rule that follows: no third-party subresources

`require-corp` blocks cross-origin fonts, scripts, images, stylesheets and iframes that do not opt
in. A `<link>` to Google Fonts does not error loudly — the page just loses its font, and nobody
notices until someone reports it.

So: self-host everything. `tests/e2e/isolation.spec.ts` asserts that a page makes **zero**
cross-origin requests, which turns this from a convention into a build failure.

## Same-origin subresources do not need CORP

Definitively: `Cross-Origin-Resource-Policy` is consulted **only** for cross-origin loads. The
vendored wasm, workers and worklet are served from the page's own origin, so they need no extra
header. Caddy does not set one, and Vite does not either.

Two things follow from this.

First, SuperSonic carries a **cross-origin worker shim** — it detects a cross-origin worker URL,
fetches the script, wraps it in a `Blob` and constructs the Worker from a blob URL. That path needs
CORS (not CORP), is harder to debug, and defeats HTTP caching. Keeping the engine same-origin means
never taking it.

Second, and this is the design consequence: the shared engine directory must **not** live on its
own subdomain. `engine.example.com/0.88.0/` is tempting for deduplication, and it immediately drags
in CORS, CORP, the blob-worker path and a second certificate. Instead the engine is shared **on
disk** and hardlinked into each release, so every page serves it from its own origin. See
[DEPLOY.md](DEPLOY.md).

## Local development

**Plain `http://localhost` is already a secure context**, and `crossOriginIsolated` becomes true as
soon as the headers are present. No TLS needed for the normal loop — `npm run dev` stays HTTP.

mkcert (already installed) earns its place for exactly one job: testing on a physical phone over
the LAN, where a secure context needs real TLS and iOS additionally wants a trusted chain. That is
an opt-in path, not the default.

## Checking it by hand

```sh
curl -sI http://localhost:3000/ | grep -i cross-origin   # dev
curl -sI http://localhost:4173/ | grep -i cross-origin   # preview
npm run e2e                                              # the real answer
```

The curl checks are necessary but not sufficient. Only a browser can tell you whether isolation was
actually granted, which is why the e2e spec evaluates `crossOriginIsolated` in the page rather than
trusting the headers it just read.
