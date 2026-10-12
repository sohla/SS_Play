import sites from '../../infra/sites.json' with { type: 'json' }

// Page paths come from the file that generates the Caddyfile and drives the
// assembled build, so a spec cannot test a path the site does not serve.
function pathOf(app: string): string {
  const page = sites.pages.find((candidate) => candidate.app === app)
  if (!page) {
    throw new Error(
      `No page for app "${app}" in infra/sites.json. Known: ` +
        sites.pages.map((candidate) => candidate.app).join(', '),
    )
  }
  return page.path
}

export const LANDING = '/'
export const TOUCH = pathOf('touch')
export const DROPLET = pathOf('droplet')

/**
 * The page the engine-level specs load.
 *
 * `boot.spec.ts`, `isolation.spec.ts` and `audio.ts` are about the engine and
 * the build rather than about any page — but the engine is a WebAssembly
 * AudioWorklet, so it only exists inside a loaded document and they have to open
 * *something*.
 *
 * It was the def browser, which staged the whole vendored library and a sample
 * *for these specs* — a test fixture living in a user-facing page, which is why
 * deleting that page broke twenty tests across four files. Named here so the
 * next deletion sees the coupling instead of discovering it.
 *
 * `/touch/` now, because a capture needs a host that **makes no sound of its
 * own**: anything else playing lands in the recording and every threshold ends
 * up measuring it too. The multitouch surface boots the engine and stays silent
 * until a finger arrives.
 *
 * Still the wrong shape. The fixture belongs outside `apps/` entirely, served by
 * `tools/serve.mjs`, so nothing test-only reaches a visitor and any page can be
 * deleted without touching the suite.
 */
export const ENGINE_HOST = TOUCH

/**
 * The page the layout specs load: the busiest one after boot.
 *
 * Was the def browser, whose generated surface and OSC log held the longest
 * strings on the site and so caught horizontal overflow. The pulse bench
 * inherits that: nine sliders, a canvas, and the longest hint text here.
 */
export const CONTROLS_HOST = pathOf('thrum')
