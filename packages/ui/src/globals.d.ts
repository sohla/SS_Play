/**
 * Injected by `@ss/vite-preset` at build time, the same as in each app's own
 * `env.d.ts`.
 *
 * Declared here because `PageHeader` reads it: a page's icon follows from its
 * name, so every page gets one without passing anything down. Doing it the
 * other way — a prop — would mean threading the app name through
 * `MotionInstrument` and into all twelve pages that use it, to say something the
 * build already knows.
 */
declare const __SS_APP_NAME__: string
