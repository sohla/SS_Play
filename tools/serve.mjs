#!/usr/bin/env node
// Serve the assembled site locally, with the headers Caddy will send.
//
//   node tools/serve.mjs [--port 4173]
//
// `vite preview` serves one app at a time, so it cannot represent a site whose
// pages share an origin — the landing page's links would 404 and nothing would
// exercise the real paths. This serves dist/ the way production does, which is
// what the e2e suite needs to be testing.
//
// Headers come from infra/headers.json through the same expansion the Caddyfile
// uses, so this server and production cannot disagree about isolation.

import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cachePaths, readJson } from '../infra/cache-paths.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const root = join(repoRoot, 'dist')

const headers = readJson('headers.json')
const sites = readJson('sites.json')
const { immutable, revalidate } = cachePaths(headers, sites)

/**
 * The sample store, which is outside the repo and outside dist/.
 *
 * Caddy serves it in production from a shared directory with its own
 * handle_path block; here it is a second root, so the sample page behaves the
 * same locally and the e2e suite exercises the real URL shape instead of a
 * fixture.
 *
 * A missing store is normal rather than an error — most pages have nothing to do
 * with samples, and requiring one to run the site would break the common case.
 * The index is answered as an empty list, which is what a server with an empty
 * store returns anyway, so the page's "nothing here yet" path gets exercised
 * too.
 *
 * The index is generated per request rather than cached, because the point of a
 * local store is dropping a file in and reloading.
 */
const sampleStore = process.env['SS_SAMPLES_DIR'] ?? join(repoRoot, '..', 'SS_Play-samples')
const samplePath = sites.samplePath
const PLAYABLE = ['.wav', '.flac', '.mp3', '.ogg', '.m4a', '.opus']

function sampleIndex() {
  if (!existsSync(sampleStore) || !statSync(sampleStore).isDirectory()) return { samples: [] }

  const samples = readdirSync(sampleStore, { withFileTypes: true })
    .filter((entry) => entry.isFile() && PLAYABLE.includes(extname(entry.name).toLowerCase()))
    .map((entry) => ({
      name: entry.name,
      bytes: statSync(join(sampleStore, entry.name)).size,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { samples }
}

const portArg = process.argv.indexOf('--port')
const port = portArg === -1 ? 4173 : Number(process.argv[portArg + 1])

if (!existsSync(join(root, 'index.html'))) {
  console.error(`No assembled site at ${root}. Run \`npm run build\` first.`)
  process.exit(1)
}

// A wrong MIME on the wasm breaks streaming compilation and surfaces as a
// generic boot failure, so the engine's three types are spelled out rather
// than left to a lookup table's defaults.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.scsyndef': 'application/octet-stream',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

/** Caddy's `path` matcher semantics: exact, or prefix when the glob ends in *. */
const matches = (pattern, path) =>
  pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : pattern === path

function cacheControl(path) {
  if (immutable.some((p) => matches(p, path))) return headers.immutable['Cache-Control']
  if (revalidate.some((p) => matches(p, path))) return headers.revalidate['Cache-Control']
  return undefined
}

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)

  // The store is the second root, matching production's handle_path. Served
  // before the release tree so a page directory named `samples` could never
  // shadow it.
  const underSamples = path.startsWith(samplePath)
  const servedRoot = underSamples ? sampleStore : root
  const relative = underSamples ? path.slice(samplePath.length) : path

  if (underSamples && relative === 'index.json') {
    const body = `${JSON.stringify(sampleIndex(), null, 2)}\n`
    response
      .writeHead(200, {
        ...headers.document,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': headers.revalidate['Cache-Control'],
        'Content-Length': Buffer.byteLength(body),
      })
      .end(body)
    return
  }

  // normalize before resolve: without it, '/../' escapes the served tree.
  const candidate = resolve(servedRoot, '.' + normalize(`/${relative}`))
  if (!candidate.startsWith(servedRoot)) {
    response.writeHead(403).end('forbidden')
    return
  }

  let file = candidate
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')

  const sent = { ...headers.document }
  const control = cacheControl(path)
  if (control) sent['Cache-Control'] = control

  if (!existsSync(file) || !statSync(file).isFile()) {
    // No index.html fallback. None of these pages has a client-side router, so
    // a fallback would answer a missing .scsyndef or .wasm with HTML and a 200
    // — which surfaces as an opaque parse error instead of a 404.
    // Logged, because a 404 in a worker or a wasm fetch does not surface in the
    // page's own console — it arrives as an opaque boot failure instead.
    console.log(`404 ${path}`)
    response.writeHead(404, { ...sent, 'Content-Type': 'text/plain' }).end('not found')
    return
  }

  sent['Content-Type'] = TYPES[extname(file)] ?? 'application/octet-stream'
  sent['Content-Length'] = statSync(file).size

  response.writeHead(200, sent)
  createReadStream(file).pipe(response)
}).listen(port, () => {
  console.log(`serving dist/ at http://localhost:${port}/`)
  for (const page of sites.pages) console.log(`  http://localhost:${port}${page.path}`)
  const { samples } = sampleIndex()
  console.log(
    `samples ${samplePath} from ${sampleStore}` +
      (existsSync(sampleStore) ? ` (${samples.length})` : ' (absent)'),
  )
})
