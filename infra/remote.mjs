// How this project talks to the VM.
//
// Shared by infra/deploy.mjs and infra/samples.mjs. Two copies of the ssh
// options would drift, and the ones here are not arbitrary — each flag is a
// failure that happened once. The same reasoning as cache-paths.mjs: anything
// both scripts have to agree about lives in one file.

import { execFileSync } from 'node:child_process'

/**
 * openrsync, protocol 29 — not GNU rsync 3.x.
 *
 * Forbidden here, all GNU-only: `-a` (expands to -rlptgoD, and -g/-o need root
 * so they fail as the deploy user), `--info=progress2`, `--delete-delay`,
 * `--mkpath` (hence an explicit `mkdir -p` first), `--chown`, `-z` with zstd.
 *
 * `--chmod` takes *relative* modes after a D/F prefix. `D755,F644` is rejected
 * outright, which is worth knowing because it reads as obviously correct.
 */
export const RSYNC_FLAGS = ['-rlpt', '--delete', '--chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r']

export const DEPLOY_USER = process.env['SSPLAY_USER'] ?? 'deploy'

// One TCP connection for the whole run, shared by every ssh, scp and rsync.
// Otherwise a deploy makes half a dozen connections and each is a chance to
// fail — which it did: unattended-upgrades restarted sshd mid-run and took the
// deploy with it, after the files were already in place.
//
// ControlPath uses %C, a hash of the connection parameters, because a unix
// socket path is capped at ~104 characters and a readable one overruns it.
export const SSH_OPTS = [
  '-o',
  'ControlMaster=auto',
  '-o',
  'ControlPath=~/.ssh/ssplay-%C',
  '-o',
  'ControlPersist=120',
  '-o',
  'ConnectTimeout=20',
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ServerAliveCountMax=4',
]

/** openrsync takes --rsh as one string, so the options are joined rather than spread. */
export const rsh = () => ['-e', `ssh ${SSH_OPTS.join(' ')}`]

export function die(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

export function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { encoding: 'utf8', ...options })
}

/**
 * Retry once on a connection failure, not on a command failure.
 *
 * sshd exits 255 for its own errors and passes the remote command's status
 * through otherwise, so 255 is the one status worth retrying — a failed
 * `mkdir` should surface immediately rather than being attempted twice.
 */
export function retrying(attempt) {
  try {
    return attempt()
  } catch (error) {
    if (error.status !== 255) throw error
    console.log('  connection dropped, retrying once')
    return attempt()
  }
}

/** Run a command on the VM. Quoted as one argv entry so the local shell is never involved. */
export function remoteOn(target) {
  return (script) => retrying(() => run('ssh', [...SSH_OPTS, target, script]))
}

/** Parse `--flag` and `--name value` out of argv, the way both scripts expect. */
export function cli(argv = process.argv.slice(2)) {
  return {
    args: argv,
    flag: (name) => argv.includes(`--${name}`),
    value: (name) => {
      const at = argv.indexOf(`--${name}`)
      return at === -1 ? undefined : argv[at + 1]
    },
  }
}
