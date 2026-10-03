#!/usr/bin/env node
// Launches the authoring rig. Separate from sc.mjs because this one is meant to
// stay open: it boots a server, opens a window, and watches for saves.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sidecar = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sclang =
  [process.env.SCLANG, '/Applications/SuperCollider/SuperCollider.app/Contents/MacOS/sclang']
    .filter(Boolean)
    .find((path) => existsSync(path))

if (!sclang) {
  console.error('SuperCollider not found. Set SCLANG=/path/to/sclang.')
  process.exit(1)
}

const config = join(sidecar, 'out', 'sclang_conf.yaml')
if (!existsSync(config)) {
  console.error('No class-path config yet. Run `npm run sc:build` once first.')
  process.exit(1)
}

mkdirSync(join(sidecar, 'out'), { recursive: true })

const child = spawn(
  sclang,
  ['-l', config, '-d', sidecar, join(sidecar, 'live.scd'), process.argv[2] ?? 'ssp_sine'],
  { stdio: 'inherit' },
)

// No timeout here, unlike sc.mjs: staying alive is the point. Ctrl-C ends it.
process.on('SIGINT', () => child.kill('SIGINT'))
child.on('close', (code) => process.exit(code ?? 0))
