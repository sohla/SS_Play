#!/usr/bin/env node
// Push the sample store to the VM.
//
//   npm run samples              list what would be pushed, send nothing
//   npm run samples -- --yes     push
//
// The store lives outside the repo. Audio is not source, and a 165MB wav
// committed once stays in the history for good — so the files are kept
// elsewhere and this is how they reach the server.
//
//   SS_SAMPLES_DIR=/path/to/audio npm run samples -- --yes
//
// Without it, a sibling of the repo: ../SS_Play-samples.
//
// They are pushed to one shared directory outside the release tree, so they
// survive every deploy, are never re-sent as part of one, and are not pruned
// when old releases are. That is the reason this is a separate command rather
// than part of `npm run deploy`.
//
// openrsync notes, which differ from GNU rsync: filters take the `--include=`
// form rather than a separate argument, and there is no --mkpath, hence an
// explicit mkdir. See infra/remote.mjs for the rest of the forbidden list.

import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cli, die, DEPLOY_USER, remoteOn, RSYNC_FLAGS, rsh, run, SSH_OPTS } from './remote.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

const { flag, value } = cli()
const apply = flag('yes')

const sites = JSON.parse(readFileSync(join(here, 'sites.json'), 'utf8'))
const { domain, subdomain, sampleRoot, samplePath } = sites

const host = value('host') ?? process.env['SSPLAY_HOST'] ?? `${subdomain}.${domain}`
const target = `${DEPLOY_USER}@${host}`
const remote = remoteOn(target)

const store =
  process.env['SS_SAMPLES_DIR'] ?? value('from') ?? join(repoRoot, '..', 'SS_Play-samples')

/**
 * What a browser will decode.
 *
 * The engine hands the bytes to the browser's decoder rather than decoding them
 * itself, so this is whatever the browser supports — not whatever libsndfile
 * does. aiff is the notable absence: SuperCollider reads it happily and Chrome
 * does not.
 */
const PLAYABLE = ['.wav', '.flac', '.mp3', '.ogg', '.m4a', '.opus']

/**
 * Loud above this, in bytes. A warning, not a refusal.
 *
 * A sample is fetched and decoded whole before it can sound, so a 100MB wav is
 * a hundred megabytes over the network and then roughly twice that in memory as
 * float32. On a page that already asks for 70MB of WebAssembly, that is the
 * difference between working and being killed.
 */
const LOUD_ABOVE = 25 * 1024 * 1024

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)}MB`
const extensionOf = (name) => name.slice(name.lastIndexOf('.')).toLowerCase()

if (!existsSync(store)) {
  die(
    `No sample store at ${store}\n\n` +
      `Create it and put audio in it, or point somewhere else:\n` +
      `  SS_SAMPLES_DIR=/path/to/audio npm run samples\n\n` +
      `It is deliberately outside the repo — audio is not source, and a large\n` +
      `file committed once stays in the history for good.`,
  )
}

if (!statSync(store).isDirectory()) die(`${store} is not a directory`)

// Flat, not recursive. The served URL is <samplePath><filename>, so a nested
// file would need its subdirectory in the name — which works, but quietly makes
// the store's internal shape part of every page's URLs. One flat directory is
// what the index and the pages assume, so say so rather than half-support it.
const entries = readdirSync(store, { withFileTypes: true })

const files = entries
  .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
  .map((entry) => ({
    name: entry.name,
    bytes: statSync(join(store, entry.name)).size,
    playable: PLAYABLE.includes(extensionOf(entry.name)),
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

// A tab or a newline in a filename would break the server-side listing this
// parses back, and would make a miserable URL besides. Rejected by name so the
// failure is one sentence rather than a malformed index.
const unparseable = files.filter((file) => /[\t\n\r]/.test(file.name))
if (unparseable.length > 0) {
  die(
    `These filenames contain a tab or a newline, which the index cannot carry:\n` +
      unparseable.map((file) => `  ${JSON.stringify(file.name)}`).join('\n') +
      `\n\nRename them and run again.`,
  )
}

const playable = files.filter((file) => file.playable)
const ignored = files.filter((file) => !file.playable)
const nested = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
const total = playable.reduce((sum, file) => sum + file.bytes, 0)

console.log(`\nstore        ${store}`)
console.log(`to           ${target}:${sampleRoot}`)
console.log(`served at    https://${host}${samplePath}`)
console.log(`playable     ${playable.length} file(s), ${mb(total)}`)

if (playable.length === 0) {
  die(
    `Nothing playable in ${store}\n\n` +
      `Looked for: ${PLAYABLE.join(' ')}\n` +
      `Found: ${files.length === 0 ? 'nothing' : files.map((file) => file.name).join(' ')}`,
  )
}

for (const file of playable) {
  console.log(
    `  ${file.name.padEnd(42)} ${mb(file.bytes).padStart(8)}` +
      (file.bytes > LOUD_ABOVE ? '  ← large' : ''),
  )
}

if (ignored.length > 0) {
  console.log(`\nNot sent, a browser cannot decode them:`)
  for (const file of ignored) console.log(`  ${file.name}`)
}

if (nested.length > 0) {
  console.log(
    `\nNot sent, the store is flat: ${nested.join(' ')}\n` +
      `A sample's URL is ${samplePath}<filename>, so a subdirectory would put the\n` +
      `store's own layout into every page's URLs.`,
  )
}

const large = playable.filter((file) => file.bytes > LOUD_ABOVE)
if (large.length > 0) {
  console.log(
    `\n${large.length} file(s) over ${mb(LOUD_ABOVE)}. Each is fetched and decoded whole before\n` +
      `it sounds, costing its size over the network and roughly twice that in\n` +
      `memory. Trimming them is usually the difference between a page that works\n` +
      `on a phone and one that is killed.`,
  )
}

if (!apply) {
  console.log(`\nListing only. Nothing was uploaded. Re-run with --yes to push.\n`)
  process.exit(0)
}

/**
 * Send only what a browser can decode.
 *
 * The store is a working directory — it will accumulate aiffs, stems, notes and
 * .DS_Store. Filtering here rather than refusing to run keeps it usable as a
 * place to actually work. An include list needs the catch-all exclude last,
 * because the first matching rule wins.
 */
const filters = [
  ...PLAYABLE.map((extension) => `--include=*${extension}`),
  // The index is the server's to write. Without excluding it, --delete would
  // remove it on every push and nothing would put it back.
  '--exclude=index.json',
  '--exclude=*',
]

// openrsync has no --mkpath.
console.log(`\nCreating ${sampleRoot}`)
remote(`mkdir -p ${sampleRoot}`)

// --delete, from RSYNC_FLAGS, so the server mirrors the store: deleting a file
// locally removes it from the site. That is what makes the local directory the
// source of truth rather than an append-only pile nobody can prune.
console.log(`Uploading`)
run('rsync', [...RSYNC_FLAGS, ...filters, ...rsh(), `${store}/`, `${target}:${sampleRoot}/`], {
  stdio: 'inherit',
})

// Listed from the server's own directory rather than from what was meant to be
// sent, so the index cannot describe a file that failed to transfer. Tab
// separated and parsed here, because building JSON in a remote shell is how you
// get a broken index the first time a filename contains a quote.
const listing = remote(
  `find ${sampleRoot} -maxdepth 1 -type f \\( ${PLAYABLE.map((extension) => `-name '*${extension}'`).join(' -o ')} \\) -printf '%s\\t%P\\n'`,
)

const present = listing
  .split('\n')
  .filter((line) => line.length > 0)
  .map((line) => {
    const tab = line.indexOf('\t')
    return { name: line.slice(tab + 1), bytes: Number(line.slice(0, tab)) }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

const indexFile = join(tmpdir(), 'ssplay-samples-index.json')
writeFileSync(indexFile, `${JSON.stringify({ samples: present }, null, 2)}\n`)
try {
  console.log(`Writing the index`)
  run('scp', [...SSH_OPTS, '-q', indexFile, `${target}:${sampleRoot}/index.json`])
  remote(`chmod 644 ${sampleRoot}/index.json`)
} finally {
  unlinkSync(indexFile)
}

console.log(`\nPushed ${present.length} sample(s) to https://${host}${samplePath}`)

// A served check, not a disk check. A file present on disk and unreachable over
// https is the failure worth catching, and it is exactly the one a new
// handle_path block can introduce.
const probe = present[0]?.name
if (probe) {
  const url = `https://${host}${samplePath}${encodeURIComponent(probe)}`
  const head = run('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code} %{content_type}', '-I', url])
  const [status, type = ''] = head.trim().split(' ')
  if (status !== '200') {
    die(
      `${url}\n  answered ${status}, not 200.\n\n` +
        `The files are on disk; Caddy is not serving them. The most likely reason\n` +
        `is that the handle_path block for ${samplePath} has not been loaded yet.\n` +
        `Run \`npm run deploy -- --yes\`, which pushes and reloads the Caddy config.`,
    )
  }
  console.log(`Served: ${probe} → ${status} ${type}`.trimEnd())
}
