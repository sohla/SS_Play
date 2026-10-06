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

import { createReadStream, existsSync, statSync } from 'node:fs'
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

  // normalize before resolve: without it, '/../' escapes the served tree.
  const candidate = resolve(root, '.' + normalize(path))
  if (!candidate.startsWith(root)) {
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
})
