/// <reference types="vite/client" />

// Injected by @ss/vite-preset at build time. Importing the preset from browser
// code would pull the bundler and node builtins into the client bundle.
declare const __SS_ENGINE_BASE__: string
declare const __SS_APP_NAME__: string
