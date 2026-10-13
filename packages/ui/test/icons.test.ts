import { describe, expect, it } from 'vitest'
import sites from '../../../infra/sites.json' with { type: 'json' }
import { ICON_APPS, hasPageIcon } from '../src/icons.tsx'

/**
 * Icons and pages have to agree in both directions.
 *
 * This is the one place in the project where a shared module is keyed by page
 * name, which makes it the one place where adding or removing a page can leave
 * something behind. The landing page already depends on every page through
 * `sites.json`, so the dependency is not new — but it is invisible, and an
 * invisible coupling is what made deleting a page hard the last time.
 *
 * So: both directions, by name, against the same file that generates the
 * Caddyfile and the build. A page without an icon fails here, and an icon for a
 * page that no longer exists fails here too.
 */

const APPS = sites.pages.map((page) => page.app)

describe('every page has an icon', () => {
  it.each(APPS)('%s', (app) => {
    expect(hasPageIcon(app), `no icon for "${app}" — add one to packages/ui/src/icons.tsx`).toBe(
      true,
    )
  })
})

describe('every icon has a page', () => {
  it('leaves nothing behind when a page is removed', () => {
    const orphans = ICON_APPS.filter((app) => !APPS.includes(app))
    expect(orphans, `icons for pages that no longer exist: ${orphans.join(', ')}`).toEqual([])
  })

  it('has exactly one icon per page, and no duplicates', () => {
    expect(ICON_APPS).toHaveLength(APPS.length)
    expect(new Set(ICON_APPS).size).toBe(ICON_APPS.length)
  })
})

describe('an unknown app is plain rather than broken', () => {
  it('reports no icon rather than throwing', () => {
    // `PageIcon` renders null for these. A page that ships without an icon
    // should look unremarkable; the tests above are what stop it staying that
    // way.
    expect(hasPageIcon('landing')).toBe(false)
    expect(hasPageIcon('')).toBe(false)
    expect(hasPageIcon('does-not-exist')).toBe(false)
  })

  it('does not claim the landing page as a page', () => {
    // It is the index, not an entry in it, and `sites.json` keeps it separate.
    expect(APPS).not.toContain(sites.landing)
  })
})
