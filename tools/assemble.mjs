#!/usr/bin/env node
// Collect every app's build into the one tree that gets deployed.
//
//   node tools/assemble.mjs
//
// The pages share a single origin, so what ships is not one app's dist but a
// tree with the landing page at the root and each other page under its own
// path. Sharing an origin is what lets the landing page link to the others
// without a DNS record per page — and what makes `require-corp` a decision
// taken once rather than per page.
//
// Page paths come from infra/sites.json, the same file that generates the
// Caddyfile, so a page cannot be built to one path and served from another.

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allPages, readJson } from '../infra/cache-paths.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const sites = readJson('sites.json')
const out = join(repoRoot, 'dist')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

for (const page of allPages(sites)) {
  const dist = join(repoRoot, 'apps', page.app, 'dist')

  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error(
      `No build for "${page.app}" at ${dist}.\n` +
        `Run \`npm run build\` first — assemble copies, it does not build.`,
    )
  }

  // page.path is '/' for the landing page, which resolves to the root itself.
  const target = join(out, page.path)
  mkdirSync(target, { recursive: true })
  cpSync(dist, target, { recursive: true })

  console.log(`${page.path.padEnd(14)} ${page.app}`)
}

console.log(`\nassembled ${allPages(sites).length} pages into dist/`)
