#!/usr/bin/env node
// Deploy the site to the VM as an atomic release.
//
//   npm run deploy          what it would do, and nothing else
//   npm run deploy -- --yes do it
//
// A release is a timestamped directory that `current` is pointed at once it is
// complete, so a visitor mid-request never sees a half-written tree. Unchanged
// files are hardlinked from the previous release, which is what keeps three
// copies of a 3.4MB engine costing one.
//
// FORBIDDEN FLAGS. This machine has openrsync (protocol 29), not GNU rsync 3.x,
// and the differences are not cosmetic:
//
//   -a              expands to -rlptgoD; -g and -o need root and fail outright
//   --chmod=D755    openrsync takes D/F only with *relative* modes (Dg+w), so
//                   the literal form is rejected. Dgo=rx works on both.
//   --mkpath        absent, hence the separate `ssh mkdir -p`
//   --info=...      absent
//   --delete-delay  absent (--delete-after exists, but plain --delete is fine
//                   into a fresh directory)
//   --chown         absent
//   -z / zstd       openrsync compresses differently and gains nothing on a
//                   tree that is already mostly wasm and compressed audio
//
// Everything below was checked against the installed openrsync before being
// committed. Re-check before adding a flag.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

const RSYNC_FLAGS = ['-rlpt', '--delete', '--chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r']
const KEEP_RELEASES = 3
const DEPLOY_USER = process.env['SSPLAY_USER'] ?? 'deploy'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? undefined : args[at + 1]
}

const apply = flag('yes')

const sites = JSON.parse(readFileSync(join(here, 'sites.json'), 'utf8'))
const { domain, subdomain, releaseRoot, pages } = sites

const host = value('host') ?? process.env['SSPLAY_HOST'] ?? `${subdomain}.${domain}`
const target = `${DEPLOY_USER}@${host}`
const url = `https://${host}`

// The whole assembled tree, not one app's dist: the pages share an origin, so
// a release is the site rather than a page. There is no --page flag because
// deploying one page of a shared origin would leave the others at whatever the
// previous release had, and the landing page would link to a mix.
const dist = join(repoRoot, 'dist')
const pageRoot = `${releaseRoot}/${subdomain}`

// UTC so releases sort chronologically regardless of where they were cut from.
const release = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace('T', '-')
  .slice(0, 15)
const releaseDir = `${pageRoot}/${release}`

function die(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { encoding: 'utf8', ...options })
}

/** Run a command on the VM. Quoted as one argv entry so the local shell is never involved. */
function remote(script) {
  return run('ssh', [target, script])
}

function git(...gitArgs) {
  return run('git', gitArgs, { cwd: repoRoot }).trim()
}

// ---------------------------------------------------------------- preflight

const checks = []

if (git('status', '--porcelain') !== '' && !flag('allow-dirty')) {
  die(
    `The working tree is dirty. A release would not correspond to any commit, so\n` +
      `there would be no way to tell later what is actually deployed.\n` +
      `Commit, or pass --allow-dirty if you know why you want that.`,
  )
}

const commit = git('rev-parse', '--short', 'HEAD')
checks.push(`commit       ${commit}${flag('allow-dirty') ? ' (plus uncommitted changes)' : ''}`)

if (flag('skip-verify')) {
  checks.push(`verify       SKIPPED`)
} else {
  console.log('Running `npm run verify` — typecheck, tests, build, e2e.\n')
  try {
    run('npm', ['run', 'verify'], { cwd: repoRoot, stdio: 'inherit' })
  } catch {
    die(`verify failed. Nothing was deployed.`)
  }
  checks.push(`verify       passed`)
}

if (!existsSync(join(dist, 'index.html'))) {
  die(`No assembled site at ${dist}. Run \`npm run build\`, which ends with tools/assemble.mjs.`)
}

checks.push(`pages        ${['/', ...pages.map((page) => page.path)].join(' ')}`)
checks.push(`from         dist/`)
checks.push(`to           ${target}:${releaseDir}`)
checks.push(`url          ${url}`)

console.log(`\n${checks.join('\n')}\n`)

if (!apply) {
  console.log('Dry run. Nothing was uploaded. Re-run with --yes to deploy.\n')
  // --dry-run so the file list is real rather than described. -v is required:
  // openrsync prints nothing at default verbosity, which reads as "no changes"
  // rather than "not told to say".
  try {
    const out = run('rsync', [
      ...RSYNC_FLAGS,
      '--dry-run',
      '-v',
      `${dist}/`,
      `${target}:${releaseDir}/`,
    ])
    // openrsync interleaves status lines with the file list, and they are not
    // marked as anything. Drop what is not a relative path.
    const noise = /^(sent |total |Transfer starting:|created directory |building file list)/
    const paths = out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !noise.test(line) && !line.endsWith('/'))
    console.log(`rsync would transfer ${paths.length} file(s):`)
    for (const path of paths.slice(0, 8)) console.log(`  ${path}`)
    if (paths.length > 8) console.log(`  … and ${paths.length - 8} more`)
  } catch {
    console.log(`Could not reach ${target} to list changes — check SSH before deploying.`)
  }
  process.exit(0)
}

// ------------------------------------------------------------------ deploy

// openrsync has no --mkpath, so the release directory has to exist first.
console.log(`Creating ${releaseDir}`)
remote(`mkdir -p ${releaseDir}`)

// Hardlink anything byte-identical to the live release instead of re-sending
// it. The engine is 3.4MB of wasm and synthdefs that changes only on a library
// bump, so most releases transfer only the hashed /assets.
// `-d` first: readlink -f resolves a dangling symlink to its target path
// anyway, so readlink alone hands rsync a directory that does not exist. rsync
// only warns, so the dedupe would quietly stop happening.
const previous = remote(
  `if [ -d ${pageRoot}/current ]; then readlink -f ${pageRoot}/current; fi`,
).trim()
const linkDest = previous && previous !== releaseDir ? [`--link-dest=${previous}`] : []
if (linkDest.length > 0) console.log(`Hardlinking unchanged files from ${previous}`)

console.log('Uploading')
run('rsync', [...RSYNC_FLAGS, ...linkDest, `${dist}/`, `${target}:${releaseDir}/`], {
  stdio: 'inherit',
})

// Record what this is, so `cat current/RELEASE` on the VM answers the question
// without needing anything local.
remote(`printf '%s\\n' ${release} ${commit} > ${releaseDir}/RELEASE`)

// `ln -sfn x current` drops the link *inside* current when current is already a
// symlink to a directory. Build it beside, then rename over — mv -T replaces
// the symlink itself atomically.
console.log('Pointing current at the new release')
remote(
  `ln -sfn ${release} ${pageRoot}/.current.new && mv -Tf ${pageRoot}/.current.new ${pageRoot}/current`,
)

// Keep the newest KEEP_RELEASES, counting the one just made. The name filter is
// what stops this touching `current`, `_engine` or anything else living here.
const pruned = remote(
  `cd ${pageRoot} && ` +
    `old=$(ls -1 | grep -E '^[0-9]{8}-[0-9]{6}$' | grep -v '^${release}$' | sort -r | tail -n +${KEEP_RELEASES}) && ` +
    `if [ -n "$old" ]; then echo "$old"; echo "$old" | xargs rm -rf; fi`,
).trim()
if (pruned) console.log(`Pruned ${pruned.split('\n').length} old release(s): ${pruned.replace(/\n/g, ' ')}`)

// ------------------------------------------------------------------ confirm

console.log(`\nDeployed ${commit} to ${url}\n`)

// The one thing worth asserting from here: isolation survived the trip. Without
// these two headers SuperSonic silently drops to its slow transport and capture
// stops working, and nothing on the page says so.
try {
  const head = run('curl', ['-sSI', '--max-time', '20', url])
  const got = Object.fromEntries(
    head
      .split('\n')
      .map((line) => line.split(':'))
      .filter((parts) => parts.length > 1)
      .map(([name, ...rest]) => [name.trim().toLowerCase(), rest.join(':').trim()]),
  )

  const expected = JSON.parse(readFileSync(join(here, 'headers.json'), 'utf8')).document
  const wrong = Object.entries(expected).filter(
    ([name, want]) => got[name.toLowerCase()] !== want,
  )

  if (wrong.length === 0) {
    console.log('Isolation headers confirmed on the live URL.')
  } else {
    console.error('\nDEPLOYED, BUT NOT CROSS-ORIGIN ISOLATED:')
    for (const [name, want] of wrong) {
      console.error(`  ${name}: expected "${want}", got "${got[name.toLowerCase()] ?? '(absent)'}"`)
    }
    console.error('\nSharedArrayBuffer will be unavailable and audio capture will not work.')
    console.error('Check `import ssheaders` is in the site block, then `caddy validate`.')
    process.exit(1)
  }
} catch {
  console.log(`Could not reach ${url} to check headers. Try: curl -I ${url}`)
}
