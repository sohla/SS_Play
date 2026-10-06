# Provisioning the VM

One-time setup, done by hand. Deploys afterwards are `npm run deploy`.

Every block below says which machine it runs on. **On your Mac** means a local terminal; **On the
VM** means inside an SSH session. Nothing here is scripted on purpose — it touches SSH access and
the firewall, where a script that half-works locks you out of your own server.

## Before you start

Done already, and worth re-checking if anything below misbehaves:

```sh
dig +short playground.soh.la          # must print the Linode IPv4
```

**DNS has to resolve before Caddy ever starts.** Caddy requests a certificate the instant a site
block loads, and Let's Encrypt rate-limits *failures* per name — five in an hour, and you are
locked out of that hostname for the rest of the week with no way to appeal. That is the single most
expensive mistake available here, which is why step 6 uses the staging endpoint first.

## 1. Trust the host key — On your Mac

Read the fingerprint from the Linode console first, so you are comparing against something the
network cannot have tampered with. In Linode: your instance → **Launch LISH Console**, log in as
root with the password from the create form, then:

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

It should print:

```
256 SHA256:Y5JKcWunQQWR14h7DXpti2o+IKCfNACQv2A3cPo6rGU root@localhost (ED25519)
```

If it matches, pin it on your Mac:

```sh
ssh-keyscan -t ed25519 playground.soh.la >> ~/.ssh/known_hosts
```

If it does **not** match, stop — do not type a password into that session.

## 2. First login and updates — In the LISH console

Stay in LISH. Attaching an SSH key on Linode's create form authorises it for `root`, and this
instance was built without that, so `ssh root@…` is refused — `Permission denied (publickey,
password)`.

That turns out not to matter. Everything root needs to do is steps 2 to 6, and step 4 disables root
SSH permanently anyway. So root access stays console-only for the life of the machine, which is one
fewer way in than the usual setup, and LISH remains the out-of-band route if SSH ever breaks.

**On the VM**, at the LISH root prompt:

```sh
apt update && apt upgrade -y
timedatectl set-timezone UTC
```

UTC because release directories are named from a UTC timestamp; matching the server makes
`ls -lt` and the directory names agree.

## 3. The deploy user — On the VM

Deploys must not run as root. rsync with `--delete` as root can reach the whole filesystem; as
`deploy` the worst case is confined to `/srv/ssplay`.

```sh
adduser --disabled-password --gecos "" deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
```

Give it your public key. **On your Mac**, print the key and its fingerprint together — derived from
the private key, not read from the `.pub` file:

```sh
ssh-keygen -y -f ~/.ssh/id_ed25519 | tee /dev/tty | ssh-keygen -lf -
```

The first line is what to paste; the second is what to check against afterwards.

Deriving it matters. An earlier run of this guide pasted a stale `id_ed25519.pub` whose private half
had since been replaced by a re-run of `ssh-keygen` — the file looked right, the fingerprint
matched *itself*, and login failed with nothing but `Permission denied (publickey,password)`.
`ssh-keygen -y` reads the private key, so it can only ever print the key SSH will actually offer.

**On the VM**, paste that first line between the quotes:

```sh
echo 'PASTE_THE_KEY_HERE' > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
ssh-keygen -lf /home/deploy/.ssh/authorized_keys
```

That last line must print the same fingerprint your Mac just showed. It catches both failures at
once: a paste truncated by the terminal, and a key that was never the right one.

`--disabled-password` means the account has no password to guess — it is reachable only by that
key. It also has no sudo, which is the point: a deploy credential should not be able to reconfigure
the machine.

The release root, owned by `deploy` so rsync needs no privilege:

```sh
install -d -m 755 -o deploy -g deploy /srv/ssplay
```

### Verify it, in a second terminal, before going further

**On your Mac**, in a *new* window, leaving the root session open:

```sh
ssh deploy@playground.soh.la 'id && ls -ld /srv/ssplay'
```

You should see `uid=1001(deploy)` and the directory owned by `deploy`. Only once that works should
you continue — the next step removes root's way in.

## 4. Close the door — On the VM

```sh
cat > /etc/ssh/sshd_config.d/99-ssplay.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin no
KbdInteractiveAuthentication no
EOF

sshd -t && systemctl restart ssh
```

`sshd -t` parses the config before the restart. Without it, a typo restarts sshd into a failed state
and your open session is the last one you get.

You keep LISH as an out-of-band way in regardless, which is what makes this safe to do at all.

## 5. Firewall — On the VM

```sh
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status verbose
```

Port 80 is not optional even though the site is HTTPS-only: Let's Encrypt's HTTP-01 challenge is
served there, and Caddy redirects it to HTTPS afterwards.

## 6. Caddy — On the VM

From the official repo, not Ubuntu's — Ubuntu ships an older Caddy, and automatic HTTPS is the
entire reason for choosing it:

```sh
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

### Install the config, but against staging first

Copy `infra/Caddyfile` from the repo. **On your Mac**:

```sh
scp infra/Caddyfile deploy@playground.soh.la:/tmp/Caddyfile
```

**On the VM**, add the staging directive at the top before installing it. Staging issues untrusted
certificates from a server with far looser limits, so a mistake here costs nothing:

```sh
{ printf '{\n\tacme_ca https://acme-staging-v02.api.letsencrypt.org/directory\n}\n\n'; cat /tmp/Caddyfile; } \
  > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl restart caddy
journalctl -u caddy -f
```

Watch for `certificate obtained successfully`. There is nothing to serve yet, so a 404 from the site
is the expected result — you are testing certificate issuance, not content.

### Switch to real certificates

Once staging succeeded:

```sh
install -m 644 /tmp/Caddyfile /etc/caddy/Caddyfile
rm -rf /var/lib/caddy/.local/share/caddy/certificates
caddy validate --config /etc/caddy/Caddyfile
systemctl restart caddy
journalctl -u caddy -n 30
```

The `rm` clears the staging certificates; without it Caddy keeps serving the untrusted one until it
expires, and every browser refuses the site.

`caddy validate` runs here rather than on your Mac because Caddy is not installed locally — which
is also why `infra/Caddyfile` is generated from `headers.json` and checked by `npm run infra:check`
rather than trusted to review.

## 7. Deploy — On your Mac

```sh
npm run deploy -- --page playground              # dry run, uploads nothing
npm run deploy -- --page playground --yes
```

The dry run prints the commit, the release path and how many files would move. The real run ends by
fetching the live URL and asserting the two isolation headers survived; if they did not, it says so
and exits non-zero.

## 8. Confirm — On your Mac

```sh
curl -sI https://playground.soh.la | grep -i 'cross-origin\|^HTTP'
```

Both must be present:

```
cross-origin-opener-policy: same-origin
cross-origin-embedder-policy: require-corp
```

Then open it in a browser and check the page reports `mode: sab`. **`postMessage` means the headers
did not arrive** — audio still works, but the low-latency transport and `startCapture` do not, and
nothing else will tell you.

## What a release looks like on disk

```
/srv/ssplay/playground/20261006-143022/     a release
/srv/ssplay/playground/20261006-151144/     the next one
/srv/ssplay/playground/current -> 20261006-151144
```

`current` is flipped only after the upload finishes, so a request landing mid-deploy is served the
old release rather than half the new one. Unchanged files are hardlinked from the previous release,
so three releases of a 5.3 MB page cost about 7 MB rather than 16 — the 3.4 MB engine is one copy
on disk no matter how many releases reference it.

`cat /srv/ssplay/playground/current/RELEASE` prints the timestamp and the git commit, which is how
you find out what is actually live.

Three releases are kept. Rolling back is a symlink:

```sh
ssh deploy@playground.soh.la \
  'cd /srv/ssplay/playground && ln -sfn 20261006-143022 .current.new && mv -Tf .current.new current'
```

No restart needed — Caddy follows the symlink per request.

## Upkeep

```sh
ssh deploy@playground.soh.la 'df -h /; ls -1 /srv/ssplay/playground'
```

Unattended upgrades are on by default on Ubuntu 24.04 and worth leaving on. Caddy renews
certificates itself at 30 days remaining; `journalctl -u caddy --since '1 week ago' | grep -i error`
is the only check that matters.
