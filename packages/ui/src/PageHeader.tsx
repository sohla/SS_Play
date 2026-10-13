import type { ReactNode } from 'react'
import { PageIcon } from './icons.tsx'

/**
 * The app this bundle was built for, or nothing.
 *
 * `typeof` rather than a bare read: the identifier is replaced by the bundler,
 * and if it ever is not, an unbooted page should lose its icon rather than throw
 * a ReferenceError in a header every page renders.
 */
const APP = typeof __SS_APP_NAME__ === 'string' ? __SS_APP_NAME__ : ''

export interface PageHeaderProps {
  /** This page's own name. */
  title: string
  /**
   * Which icon to draw. Defaults to the app the bundle was built for, which is
   * why no page has to pass anything.
   */
  app?: string
  /** Optional right-hand slot — status, a readout, a control. */
  children?: ReactNode
}

/**
 * The way back to the index, on every page that is not the index.
 *
 * Shared rather than written per page because a page without it is a dead end:
 * these are separate documents on one origin, not a single-page app, so the
 * browser's back button is the only other way out — and on a phone opened from
 * a link there may be nothing to go back to.
 */
export function PageHeader({ title, app = APP, children }: PageHeaderProps) {
  return (
    <header className="pad-safe-x flex shrink-0 items-center gap-3 border-b border-neutral-800 py-1">
      <a
        href="/"
        // A full touch target: this is the only way off the page, so it is the
        // last control that should need aiming at.
        className="flex min-h-11 items-center text-sm text-neutral-400 hover:text-neutral-200"
      >
        <span aria-hidden className="mr-1.5">
          ←
        </span>
        playground
      </a>

      <span className="flex min-w-0 items-center gap-1.5 text-neutral-600">
        <PageIcon app={app} className="h-4 w-4 shrink-0" />
        <span className="truncate font-mono text-xs">{title}</span>
      </span>

      {children ? <span className="ml-auto">{children}</span> : null}
    </header>
  )
}
