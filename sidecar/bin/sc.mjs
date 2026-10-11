#!/usr/bin/env node
// Drives headless sclang and turns its output into a process result.
//
//   node bin/sc.mjs build    compile synthdefs/*.scd -> out/
//   node bin/sc.mjs test     assert each def via SynthDescLib
//
// sclang is not on PATH, prints its results rather than returning them, and
// hangs forever on an open stdin. This wraps all three.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sidecar = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const CANDIDATES = [
  process.env['SCLANG'],
  '/Applications/SuperCollider/SuperCollider.app/Contents/MacOS/sclang',
  '/Applications/SuperCollider.app/Contents/MacOS/sclang',
].filter(Boolean)

/**
 * PIDs of every SuperCollider server currently running.
 *
 * `pgrep -x` matches the executable name, so it finds the server wherever the
 * app bundle lives. It exits 1 when nothing matches, which is the ordinary case
 * and not an error. `supernova` is included because `ServerOptions` can select
 * it even though nothing here does today.
 */
function serverPids() {
  const pids = new Set()
  for (const name of ['scsynth', 'supernova']) {
    try {
      for (const line of execFileSync('pgrep', ['-x', name], { encoding: 'utf8' }).split('\n')) {
        if (line.trim()) pids.add(line.trim())
      }
    } catch {
      // Nothing of that name is running.
    }
  }
  return pids
}

/**
 * The sclang this run spawned, so cleanup can end it.
 *
 * Killing this process does not kill its children — they are not in a killed
 * process group — so an interrupted run left sclang behind even once the server
 * was being reaped. That orphan is worse than it first looks: the continuity
 * script sits inside `waitForBoot`, so a leftover sclang can **boot a new
 * server** minutes later and recreate exactly the problem the reaping fixes.
 */
let sclangChild = null

/** End the sclang this run spawned, if it is still alive. */
function reapOwnSclang() {
  if (!sclangChild || sclangChild.exitCode !== null || sclangChild.signalCode !== null) return
  try {
    // SIGKILL rather than SIGTERM, for the same reason `runSclang` uses it on a
    // timeout: sclang at its REPL does not take the hint.
    sclangChild.kill('SIGKILL')
  } catch {
    // Already gone.
  }
}

/** A synchronous pause, for use from an exit handler where nothing can await. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Kill any server *this run* started, and only those.
 *
 * `continuity` boots a real server and the script's own `quit` only runs when
 * sclang exits normally. Two paths skip it entirely: the SIGKILL this file sends
 * when a script hangs at the REPL, and anything that kills `npm run` from
 * outside. Either way scsynth is orphaned — and it keeps the audio device, which
 * then makes **every** browser test fail at boot with a five-second `/notify`
 * timeout. That symptom points nowhere near this cause; it cost an hour once.
 *
 * The diff against `before` is the whole safety property. A SuperCollider user
 * very often has their own server running from the IDE, and killing that would
 * be a far worse bug than the one being fixed — so only PIDs that appeared while
 * this process was alive are touched.
 */
function reapServers(before) {
  const strays = [...serverPids()].filter((pid) => !before.has(pid))
  if (strays.length === 0) return

  const alive = () =>
    strays.filter((pid) => {
      try {
        // Signal 0 tests for existence without delivering anything.
        process.kill(Number(pid), 0)
        return true
      } catch {
        return false
      }
    })

  for (const pid of strays) {
    try {
      process.kill(Number(pid), 'SIGTERM')
    } catch {
      // Already gone, which is the good case.
    }
  }

  // SIGTERM is a request, and a server inside a callback can miss it. Wait
  // briefly, then stop asking.
  for (let waited = 0; waited < 2000 && alive().length > 0; waited += 100) sleepSync(100)
  for (const pid of alive()) {
    try {
      process.kill(Number(pid), 'SIGKILL')
    } catch {
      // Raced with its own exit.
    }
  }

  console.log(`[sc] stopped ${strays.length} orphaned server(s) this run started`)
}

function findSclang() {
  for (const candidate of CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate
  }
  throw new Error(
    'SuperCollider not found. Set SCLANG=/path/to/sclang, or install SuperCollider 3.14+.\n' +
      `Looked in:\n${CANDIDATES.map((c) => `  ${c}`).join('\n')}`,
  )
}

/**
 * Write the hermetic class-path config.
 *
 * Generated rather than committed because it has to name an absolute
 * SCClassLibrary path, which differs per machine.
 *
 * `excludeDefaultPaths` drops the default class library directories — and that
 * includes SCClassLibrary itself, not just the extension dirs, so naming it
 * back is mandatory. Verified: without it sclang reports "Library has not been
 * compiled successfully" and exits 1. With it, 2263 classes compile and the
 * user's seven globally-configured quarks are absent, which is the point.
 */
function writeConfig(sclangPath, outDir) {
  const classLibrary = resolve(dirname(sclangPath), '..', 'Resources', 'SCClassLibrary')
  if (!existsSync(classLibrary)) {
    throw new Error(`SCClassLibrary not found beside sclang at ${classLibrary}`)
  }

  const extras = process.env['SSP_INCLUDE_PATHS']?.split(':').filter(Boolean) ?? []
  const includePaths = [classLibrary, ...extras]

  const configPath = join(outDir, 'sclang_conf.yaml')
  writeFileSync(
    configPath,
    [
      '# GENERATED by bin/sc.mjs. Edits are overwritten.',
      'excludeDefaultPaths: true',
      'includePaths:',
      ...includePaths.map((path) => `  - ${path}`),
      'excludePaths: []',
      'postInlineWarnings: false',
      '',
    ].join('\n'),
  )

  return { configPath, classLibrary, extras }
}

const TIMEOUT_MS = Number(process.env['SSP_TIMEOUT_MS'] ?? 120_000)

function runSclang(sclangPath, configPath, script, args) {
  return new Promise((resolveRun) => {
    const child = (sclangChild = spawn(
      sclangPath,
      ['-l', configPath, '-d', sidecar, join(sidecar, script), ...args],
      // Close stdin: sclang's is an interactive REPL and a batch run that
      // never sees EOF waits at the prompt forever.
      { stdio: ['ignore', 'pipe', 'pipe'] },
    ))

    let stdout = ''
    let stderr = ''
    let timedOut = false

    // A script that throws never reaches its own `0.exit`, so sclang drops to
    // the REPL and sits there — a hang rather than a failure. Any error in a
    // .scd therefore looks like an infinite build without this.
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      stdout += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      process.stderr.write(chunk)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        console.error(
          `\n[sc] ${script} produced no exit after ${TIMEOUT_MS}ms and was killed.\n` +
            `[sc] sclang stays at its REPL when a script throws, so look for an ERROR above.`,
        )
        resolveRun({ code: 1, stdout, stderr })
        return
      }
      resolveRun({ code, stdout, stderr })
    })
  })
}

function reportTests(stdout) {
  const lines = stdout.split('\n')
  const results = lines
    .filter((line) => line.startsWith('SSP_TEST '))
    .map((line) => {
      const [, verdict, ...rest] = line.split(' ')
      return { verdict, detail: rest.join(' ') }
    })

  const failed = results.filter((r) => r.verdict === 'FAIL')
  const summary = lines.find((line) => line.startsWith('SSP_TEST_DONE'))

  return { results, failed, summary }
}

const command = process.argv[2]
if (!command || !['build', 'test', 'continuity'].includes(command)) {
  console.error('usage: sc.mjs <build|test|continuity>')
  process.exit(2)
}

const sclangPath = findSclang()

// Snapshotted before anything is spawned, so the diff can only ever contain
// servers this run is responsible for.
const serversBefore = serverPids()

// `exit` is the catch-all: it covers a normal return, an explicit `process.exit`
// and an uncaught throw. The signal handlers are separate because a signal
// terminates the process *without* running exit handlers unless it is handled.
//
// sclang is killed *before* the servers are reaped, and the order matters: a
// live sclang sitting in `waitForBoot` can boot a replacement the moment the
// old one dies, so reaping first would be a race against the thing being
// cleaned up.
process.on('exit', () => {
  reapOwnSclang()
  reapServers(serversBefore)
})
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    reapOwnSclang()
    reapServers(serversBefore)
    process.exit(130)
  })
}
const outDir = join(sidecar, 'out')
mkdirSync(outDir, { recursive: true })

const { configPath, classLibrary, extras } = writeConfig(sclangPath, outDir)

if (extras.length > 0) {
  console.log(`[sc] SSP_INCLUDE_PATHS adds ${extras.length} path(s) — build is no longer hermetic`)
}

// Recorded so a byte-diff in the output can be attributed to a SuperCollider
// upgrade rather than to a source change.
const version = await runSclang(sclangPath, configPath, 'lib/ssp_version.scd', [])
writeFileSync(
  join(outDir, 'sc-version.txt'),
  [
    `sclang: ${sclangPath}`,
    `classLibrary: ${classLibrary}`,
    (version.stdout.match(/^SSP_VERSION .*$/m)?.[0] ?? 'SSP_VERSION unknown').trim(),
    '',
  ].join('\n'),
)

const script = { build: 'build.scd', test: 'test.scd', continuity: 'tests/reload_continuity.scd' }[
  command
]
const { code, stdout } = await runSclang(sclangPath, configPath, script, [outDir])

if (code !== 0) {
  console.error(`\n[sc] sclang exited ${code}`)
  process.exit(code ?? 1)
}

if (command === 'test' || command === 'continuity') {
  const { results, failed, summary } = reportTests(stdout)

  // A run that produced no assertions is a failure, not a pass: it usually
  // means the script died before reaching them.
  if (results.length === 0) {
    console.error('[sc] no SSP_TEST lines were produced')
    process.exit(1)
  }

  console.log(`\n[sc] ${summary ?? `${results.length - failed.length}/${results.length} passed`}`)
  if (failed.length > 0) process.exit(1)
}
