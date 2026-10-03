const SOURCE_URL = 'https://github.com/sohla/SS_Play'

// supersonic-scsynth is AGPL-3.0-or-later and is bundled into this page's
// JavaScript, which makes the page a derivative work conveyed over a network.
// Every deployed page has to offer its source, so this lives in the shared kit
// rather than in each app where it could be forgotten.
export function SourceFooter() {
  return (
    <footer className="mt-10 border-t border-neutral-800 pt-4 text-xs text-neutral-500">
      Runs{' '}
      <a
        className="underline decoration-dotted hover:text-neutral-300"
        href="https://github.com/samaaron/supersonic"
      >
        SuperSonic
      </a>{' '}
      (SuperCollider scsynth, AGPL-3.0-or-later).{' '}
      <a className="underline decoration-dotted hover:text-neutral-300" href={SOURCE_URL}>
        Source for this page
      </a>
      .
    </footer>
  )
}
