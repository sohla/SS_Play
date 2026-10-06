// Expand the per-page cache patterns in headers.json across every page.
//
// Shared by infra/gen.mjs, which renders them into the Caddyfile, and
// tools/serve.mjs, which applies them to the local assembled site. Two
// expansions of the same patterns would drift, and the whole point of
// headers.json is that the servers cannot disagree.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const readJson = (name) => JSON.parse(readFileSync(join(here, name), 'utf8'))

/** Every page in URL order, landing first. */
export function allPages(sites) {
  return [
    { app: sites.landing, path: '/', title: 'landing', engine: false },
    ...sites.pages,
  ]
}

const under = (base, pattern) => `${base}${pattern}`

/**
 * Absolute path globs for each cache policy.
 *
 * Patterns are relative to a page's own root so that adding a page cannot
 * leave a rule behind. Engine patterns are skipped for pages that carry no
 * engine — the landing page has no vendor tree, and a glob matching nothing is
 * invisible: the site works, slightly worse, indefinitely.
 */
export function cachePaths(headers, sites) {
  const pages = allPages(sites)

  const immutable = pages.flatMap((page) =>
    headers.immutablePagePaths.map((pattern) => under(page.path, pattern)),
  )

  const revalidate = [
    ...pages.flatMap((page) => [
      ...headers.revalidatePagePaths.map((pattern) => under(page.path, pattern)),
      ...(page.engine ? headers.revalidateEnginePaths.map((p) => under(page.path, p)) : []),
    ]),
    // The shared sample store. Not page-relative, because it sits outside every
    // release — there is one of it rather than one per page.
    //
    // Revalidated rather than immutable-cached, which is the honest choice here:
    // the names are stable and the bytes behind them are not. Replacing a file
    // and keeping its name is the entire point of a store you push to, and an
    // immutable header would leave a visitor hearing last week's audio with no
    // way to discover it.
    ...(headers.revalidateSharedPaths ?? []).map((pattern) => under(sites.samplePath, pattern)),
  ]

  return { immutable, revalidate }
}
