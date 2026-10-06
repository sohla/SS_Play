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
export const PLAYGROUND = pathOf('playground')
export const TOUCH = pathOf('touch')
export const IMU = pathOf('imu')
export const DROPLET = pathOf('droplet')
