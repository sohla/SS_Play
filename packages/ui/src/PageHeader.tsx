import type { ReactNode } from 'react'

export interface PageHeaderProps {
  /** This page's own name. */
  title: string
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
export function PageHeader({ title, children }: PageHeaderProps) {
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

      <span className="truncate font-mono text-xs text-neutral-600">{title}</span>

      {children ? <span className="ml-auto">{children}</span> : null}
    </header>
  )
}
