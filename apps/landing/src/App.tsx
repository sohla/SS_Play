import { SourceFooter } from '@ss/ui'
import sites from '../../../infra/sites.json'

// The list comes from infra/sites.json, the same file that generates the
// Caddyfile and the cache rules. A page that exists but is not linked, or a
// link to a page that was never deployed, are both impossible by construction.
const { pages } = sites

export function App() {
  return (
    <main className="pad-safe mx-auto max-w-2xl pt-12 sm:pt-16">
      <h1 className="text-2xl font-semibold text-neutral-100">playground</h1>
      <p className="mt-3 text-neutral-400">
        Web pages running SuperCollider&rsquo;s <code className="text-neutral-300">scsynth</code> in
        the browser, compiled to WebAssembly. Everything synthesises on your machine; nothing is
        rendered on a server.
      </p>

      <ul className="mt-10 space-y-3">
        {pages.map((page) => (
          <li key={page.path}>
            <a
              href={page.path}
              className="group block rounded-lg border border-neutral-800 bg-surface p-5 transition-colors hover:border-neutral-600"
            >
              <span className="flex items-baseline gap-3">
                <span className="text-lg text-neutral-100 group-hover:text-white">
                  {page.title}
                </span>
                {'temporary' in page && page.temporary ? (
                  <span className="rounded border border-amber-900/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-500/90">
                    temporary
                  </span>
                ) : null}
              </span>
              <span className="mt-2 block text-sm text-neutral-400">{page.blurb}</span>
            </a>
          </li>
        ))}
      </ul>

      <p className="mt-10 text-sm text-neutral-500">
        Each page needs a browser with <code className="text-neutral-400">SharedArrayBuffer</code>,
        which the site&rsquo;s isolation headers enable. Audio needs a tap or a click first &mdash;
        browsers will not start an audio context without one.
      </p>

      <SourceFooter />
    </main>
  )
}
