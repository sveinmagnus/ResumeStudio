# Resume Studio — Self-hosted server deployment

This is the **server build**: the same Express + SQLite + React app as the
portable desktop build, run as a long-lived Node service — typically one small
VPS behind a domain name, holding one person's or one team's CVs.

[DESKTOP.md](./DESKTOP.md) covers the double-clickable build. That one binds
loopback, needs no certificate, no proxy and no token, and manages itself from
an in-app Settings screen. **None of that applies here.** A server build is
reachable by anyone who can reach the port, and everything below exists because
the app does not defend that port for you.

---

## 1. What this deployment is, and is not

**It is single-tenant.** `RESUME_API_TOKEN` authenticates a *secret*, not a
person. No query is scoped by user: `listResumes()` returns every row, so every
holder of a valid token can read, edit, export and delete **every CV in the
instance**. `RESUME_API_TOKENS` attaches a nickname to a token and stamps it as
`saved_by`, and `server/auth.ts` states the limit in its own comment —
*attribution, not authentication*.

That is exactly right for one consultant, and workable for a small team who all
have access to each other's CVs anyway. It is **not** a fit for a firm where
consultants should not read each other's résumés. The work that changes it —
accounts, per-resume ownership, an owner role — is designed in
[`plans/multi-user-auth.md`](./plans/multi-user-auth.md); this document is that
plan's Phase 0.

**It has no TLS of its own.** The server does a plain `app.listen`: no
certificate handling, no HTTP-to-HTTPS redirect. See §4.

**It never updates itself.** `/api/update` reports `supported: false` and its
mutating routes 403 on any build the desktop launcher did not wire. A service
rewriting its own files while running is a different proposition from a desktop
app doing it, and the app declines. Upgrading is §12.

**Its settings live in the environment.** The gear icon shows a read-only view;
`PUT /api/settings` 403s off the desktop build. Everything is configured through
environment variables (§11).

**It has no sync folder.** `RESUME_BACKUP_DIR` drives the desktop build's
cross-computer sync, and the scheduler and watcher behind it are started by the
desktop launcher only — `server/index.ts` never seeds them. Setting the variable
here gets you routes that work when called by hand and nothing that calls them.
Off-box backups are §9.

---

## 2. Requirements

**Node 24 or newer — a hard floor, not a recommendation.** The database is
Node's built-in `node:sqlite`, which is behind a flag on 22 and below.
`package.json → engines` declares `>=24` and CI enforces it. There is no native
addon anywhere in the tree, so there is nothing to compile and nothing to
rebuild after a Node upgrade.

**The server is not compiled.** `npm start` is
`NODE_ENV=production tsx server/index.ts`, and `tsx` is a *devDependency*. So
`npm ci --omit=dev` produces a tree that can neither build the client (`vite` is
also a devDependency) nor start the server. Install the full dependency tree on
the box.

Disk is modest — the app plus `node_modules` plus a database whose size is
dominated by embedded profile photos.

---

## 3. Install and run

```bash
git clone https://github.com/sveinmagnus/resumestudio/
cd resumestudio
npm ci
npm run build        # → dist/
npm start            # serves dist/ + /api from one Express process
```

`npm start` listens on `PORT` (default `3001`). It passes **no host** to
`app.listen`, so it listens on every interface — putting a proxy in front does
not by itself stop anyone reaching the app port directly. Close it at the
firewall, or bind the box's public interface to the proxy only.

### `NODE_ENV=production` does two separate things

Both matter, and neither is cosmetic:

1. **The session cookie only gets its `Secure` flag in production.**
   `server/routes/auth.ts → setCookieValue` builds
   `rs_token=…; Path=/; HttpOnly; SameSite=Strict` and appends `Secure` only
   when `process.env.NODE_ENV === 'production'`. Without it, the cookie carrying
   your API token is sent over plain HTTP as readily as over TLS — so anything
   that can strip TLS, or reach the app on an http:// URL, collects a working
   credential.
2. **The built client is only served in production.** `server/app.ts` resolves
   the client directory as `RESUME_CLIENT_DIR` or, failing that, `../dist`
   *only* when `NODE_ENV` is `production`. Get it wrong and you have a working
   API with no user interface: `/` 404s.

`npm start` sets it. If a supervisor invokes the entry point directly instead,
set it explicitly — see the unit file in §10, which sets it in both places for
that reason.

### Nothing loads `.env` for you

There is no `dotenv` dependency and no `--env-file` flag anywhere in the
scripts. The server reads `process.env`; populating it is the operator's job.
`.env.example` is the documentation of every variable, not a file the server
consults. Use `EnvironmentFile=` in the systemd unit (§10), or export the
variables in whatever supervises the process.

This is easy to miss because it fails quietly in the direction of *less*
security: an unset `RESUME_API_TOKEN` disables authentication (§6), so an
instance whose env never arrived starts happily and serves everything.

**Check it after the first boot.** `GET /api/auth/status` reports
`{"auth_required":true}` when a token is configured:

```bash
curl -s https://cv.example.com/api/auth/status
```

If it says `false`, your token never reached the process.

---

## 4. TLS: terminate it in a reverse proxy

The app speaks HTTP only. Put Caddy, nginx or Traefik in front and let it own
the certificate.

This is not a formality. `POST /api/auth/login` carries the API token in a
plaintext JSON body, and every request afterwards carries the same value back in
the `rs_token` cookie. Unencrypted, on a public network, that is the entire
secret of the instance, repeated on every request, to anyone on the path.

### Caddy

Caddy obtains and renews a Let's Encrypt certificate by itself, which is why
this is the whole configuration:

```caddy
cv.example.com {
	reverse_proxy 127.0.0.1:3001
}
```

Caddy sets `X-Forwarded-For` and `X-Forwarded-Proto` on its own, so pair this
with `RESUME_TRUST_PROXY=1` (§5).

### nginx

nginx sets no forwarded headers unless told to — the `proxy_set_header` lines
are what makes `RESUME_TRUST_PROXY` mean anything at all.

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name cv.example.com;

    ssl_certificate     /etc/letsencrypt/live/cv.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cv.example.com/privkey.pem;

    # The app accepts 2 MB of JSON per request and 64 MB on a backup import
    # (a zip of every resume, images included). nginx's 1 MB default would
    # reject a restore before Express ever saw it.
    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name cv.example.com;
    return 301 https://$host$request_uri;
}
```

### Health check

`GET /api/health` sits outside both the auth middleware and the rate limiter, so
an upstream check or an uptime monitor can poll it without a credential and
without spending a limiter slot. It answers `{"ok":true}` and touches no
database — it reports that the process is up, not that the data is readable.

### What the app already sends, and what to leave alone

Every response carries a Content-Security-Policy plus `X-Content-Type-Options`,
`X-Frame-Options: DENY`, `Referrer-Policy` and `Permissions-Policy`
(`server/app.ts`). The CSP is tuned to what this SPA actually needs — inline
`<style>` blocks, `blob:` image URLs for the photo cropper, `connect-src 'self'`
because every provider call is proxied server-side. **Do not add a second CSP at
the proxy.** Two policies intersect, and a generic one will break the editor.

The one header worth adding at the proxy is HSTS. The app cannot send it
sensibly: it does not know whether it is behind TLS.

---

## 5. `RESUME_TRUST_PROXY` — set it whenever there is a proxy

Behind a proxy, the socket peer of every connection is the proxy. `req.ip`
collapses to a single address for the entire internet, and the rate limiter
(§7) keys on `req.ip`. One attacker's failed-login flood then fills the one
shared bucket and returns 429 to **everybody** — the brake becomes the denial of
service it was meant to prevent.

Setting `RESUME_TRUST_PROXY` makes Express read `X-Forwarded-For`, so the
limiter keys on the real client again. Accepted values (`server/app.ts`):

| Value | Meaning |
|---|---|
| `1`, `2`, … | A **hop count** — how many proxies in front of the app you control, counted back from it. One nginx or Caddy is `1`; a CDN in front of that is `2`. |
| `true` | Trust the whole chain. Correct only when nothing but your proxy can reach the app port; otherwise a client sets its own `X-Forwarded-For` and chooses which rate-limit bucket to fill. |
| anything else | Handed to Express verbatim as its `trust proxy` setting — a preset such as `loopback`, or an IP/subnet list. |

It is **off by default**, and that default is right for dev and for the desktop
build: a directly-bound server must never believe a header the client wrote.

The limiter key is the *only* thing this affects here — the app reads no other
forwarded value. In particular the cookie's `Secure` flag comes from `NODE_ENV`
and not from `X-Forwarded-Proto`, so §3's rule stands on its own and this
setting does not substitute for it.

---

## 6. Authentication

`RESUME_API_TOKEN` is the credential for the whole instance. Generate one with
`openssl rand -hex 32` and treat it as the password it is.

- It is presented either as `Authorization: Bearer <token>` (curl, scripts,
  tests) or as the `rs_token` cookie a browser receives from
  `POST /api/auth/login`. Same value both ways; the cookie is `HttpOnly` so page
  JavaScript — and therefore any XSS — cannot read it.
- Comparison is constant-time, and every configured candidate is compared with
  no early return, so response timing does not reveal which token half-matched.
- Failure paths all return the same bare 401. Distinguishing "missing" from
  "wrong" would leak what the parser saw.

### An empty token disables authentication, deliberately

`isAuthRequired()` is false when no token is configured, and `authMiddleware`
then passes every request through. This is what makes local development and the
loopback desktop build usable without ceremony.

It also means an exposed instance with no token is wide open, and
[SECURITY.md](./SECURITY.md) puts exactly that out of scope: it is a deployment
choice, not a vulnerability. There is nothing to report and nothing to fix — set
the token.

### Named tokens are attribution, not authorization

`RESUME_API_TOKENS=kari:f3a9…,ola:7bc1…` adds named tokens alongside the
anonymous single one. The name is stamped as `saved_by` on saves and snapshots
and shown in History and on the picker cards, which answers "who changed this".
It answers nothing else: **every valid token, named or not, has full access to
every CV.** Do not read the name list as a permission model.

### Rotation

Changing a token means editing the environment and restarting. There is no
revocation list and no server-side session table, so a leaked token stays valid
until the variable changes — and when it does, every browser session is
invalidated at once, because the cookie *is* the token.

---

## 7. Rate limiting

Two limiters, both keyed by IP (which is why §5 matters).

**The API limiter** — `RESUME_RATE_LIMIT_MAX` (default `50`) per
`RESUME_RATE_LIMIT_WINDOW_MS` (default `900000`, 15 minutes). It runs on every
`/api` router *before* `authMiddleware`, and on `/api/auth` too, so login
failures are counted.

It sets `skipSuccessfulRequests`, and that is the whole design: **only responses
of status 400 and above consume the budget.** A consultant editing a CV is a
steady stream of 2xx auto-save PUTs, roughly one per second, that never
accumulates against the window; somebody guessing the bearer token accumulates
on every attempt. So this brakes brute force and bad-request floods without ever
throttling legitimate work.

The practical consequence: if users report 429s, raising the maximum is almost
certainly the wrong fix. Normal editing costs nothing, so a filled bucket means
either a real attack or a client generating errors — find out which.

**The translate limiter** — `RESUME_TRANSLATE_RATE_LIMIT_MAX` (default `60`) per
`RESUME_TRANSLATE_RATE_LIMIT_WINDOW_MS` (default `60000`, one minute) — applies
additionally to `/api/translate`, `/api/summarize` and `/api/llm`, and counts
**successful** calls too. A successful call against a paid DeepL, OpenAI or
Azure key costs money, so without it a leaked token could run up the provider
bill at wire speed. The default sits far above human drafting pace.

---

## 8. The database, and where it must not live

The SQLite file lives at `data/resume.db`, resolved relative to the server
module rather than the working directory, so it lands beside `server/` in the
checkout. `RESUME_DB_PATH` overrides it with an exact path. (`RESUME_DATA_DIR`
does **not** move it here — that variable is read by the desktop launcher's path
resolution, which this entry point never calls.)

One file holds everything: every resume, plus up to 50 snapshots per resume in
`resume_snapshots` (`ON DELETE CASCADE`). **The in-app History feature is not a
backup** — it lives inside the file you are trying to protect. That is what §9
is about.

At boot the file is `chmod`'ed to `0600` and `data/` to `0700` where the OS
supports it. That is only worth something if the service runs as its own
unprivileged user (§10).

### Never put the live database on a synced or network volume

WAL mode leaves long-lived `-wal` and `-shm` sidecar files. A cloud-sync client
(Drive, Dropbox, OneDrive) or a flaky network filesystem uploads or flushes
those pieces at inconsistent moments, and the result is a database that no
longer opens. On the desktop build a damaged file produces an explicit refusal
and a recovery note; on a server it is simply an exception from `node:sqlite`
on the first request that touches it, and a 500 for every request thereafter.

If you genuinely have no choice — the only writable volume is an NFS mount, say
— `RESUME_DB_JOURNAL=TRUNCATE` keeps everything inside the single `.db` file
between transactions, leaving no sidecars for a sync client to tear. It is the
documented escape hatch, not a recommendation: it removes the sidecars, not the
hazard of two machines writing the same file. `WAL`, `TRUNCATE`, `DELETE`,
`PERSIST`, `MEMORY` and `OFF` are accepted; anything else falls back to `WAL`.

---

## 9. Off-box backups

`data/resume.db` is the only copy of the data, and the snapshot history a user
would restore from is inside it. Lose the file and you lose the history that
would have recovered it. Nothing in the server build writes a second copy on its
own.

The supported route is **`GET /api/backup/export`**: a zip holding one JSON file
per resume plus `resume-studio-registry.json` — the same layout the desktop sync
folder uses. It is auth-gated, available on every build, and needs no configured
folder. `POST /api/backup/import` takes that zip (or one resume file out of it)
back and merges **by resume id**, so restoring updates resumes in place and
never mints duplicates.

Pull it from somewhere that is not the server, which is the whole point:

```sh
#!/bin/sh
# /usr/local/bin/resume-studio-backup   (run on the BACKUP host, not the VPS)
set -eu
: "${RESUME_API_TOKEN:?token not set}"
dest=/var/backups/resume-studio
mkdir -p "$dest"
curl -fsS --max-time 120 \
  -H "Authorization: Bearer $RESUME_API_TOKEN" \
  -o "$dest/resume-studio-$(date +%F).zip" \
  https://cv.example.com/api/backup/export
find "$dest" -name 'resume-studio-*.zip' -mtime +30 -delete
```

```cron
17 3 * * *  /usr/local/bin/resume-studio-backup
```

Two details in that script earn their place. `curl -f` is what makes a failure a
failure: without it curl writes the error body into the file and the job
"succeeds" every night, leaving you thirty daily backups containing forty bytes
of JSON. And the export is a *successful* response, so a nightly job never
touches the failure-focused limiter (§7).

Restoring: drop the zip on the resume picker, or

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $RESUME_API_TOKEN" \
  -H 'Content-Type: application/zip' \
  --data-binary @resume-studio-2026-08-20.zip \
  https://cv.example.com/api/backup/import
```

A file-level copy of `data/resume.db` is a reasonable second line, but only from
a stopped service or through `sqlite3 data/resume.db ".backup '/path/out.db'"`.
Copying a live WAL database with `cp` copies a torn file, which is the failure
mode §8 describes.

Test a restore into a scratch instance at least once. An untested backup is a
hypothesis.

---

## 10. A systemd unit

```ini
[Unit]
Description=Resume Studio
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=resumestudio
Group=resumestudio
WorkingDirectory=/srv/resume-studio

# Nothing in the app reads .env (see DEPLOYING.md section 3) — this is what puts
# the variables into the process. Keep the file 0600; it holds the API token.
EnvironmentFile=/etc/resume-studio.env

# Also set by `npm start`. Stated here too so that changing how the service is
# launched cannot silently drop the session cookie's Secure flag.
Environment=NODE_ENV=production

# npm wants a writable cache and log directory; ProtectHome puts the service
# account's own home out of reach.
Environment=npm_config_cache=/srv/resume-studio/.npm

ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/resume-studio/data /srv/resume-studio/.npm

[Install]
WantedBy=multi-user.target
```

`/etc/resume-studio.env`:

```
PORT=3001
RESUME_API_TOKEN=<openssl rand -hex 32>
RESUME_TRUST_PROXY=1
```

`ProtectSystem=strict` makes the whole filesystem read-only except what
`ReadWritePaths` names, which is the useful shape here: the service writes one
directory, `data/`. Deployments (`git pull`, `npm ci`, `npm run build`) happen
outside the unit, as a user who can write the checkout.

---

## 11. Configuration reference

The server build's variables. `.env.example` documents all of them, including
the translation and AI-assist providers, in more detail.

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | Must be `production` — `Secure` cookie flag **and** serving the built client (§3) | unset |
| `PORT` | Listen port | `3001` |
| `RESUME_API_TOKEN` | The API credential. **Empty disables authentication** (§6) | empty |
| `RESUME_API_TOKENS` | `name:token` pairs for `saved_by` attribution. Not a permission model | empty |
| `RESUME_TRUST_PROXY` | Trust `X-Forwarded-For` for the rate-limiter key: hop count, `true`, or an Express preset (§5) | off |
| `RESUME_RATE_LIMIT_MAX` / `_WINDOW_MS` | Failure-focused API limiter (§7) | `50` / `900000` |
| `RESUME_TRANSLATE_RATE_LIMIT_MAX` / `_WINDOW_MS` | Success-inclusive limiter on translate / summarize / LLM (§7) | `60` / `60000` |
| `RESUME_DB_PATH` | Exact database file | `<checkout>/data/resume.db` |
| `RESUME_DB_JOURNAL` | SQLite journal mode; `TRUNCATE` is the synced-volume escape hatch (§8) | `WAL` |
| `RESUME_CLIENT_DIR` | Where the built client lives | `<checkout>/dist` when `NODE_ENV=production` |
| `TRANSLATE_PROVIDER` + provider keys | Translation backend (`off`/`libretranslate`/`deepl`/`google`/`azure`/`llm`) | unset (off) |
| `LLM_PROVIDER` / `LLM_MODEL` / `LLM_HIGH_END` + provider keys | AI-assist backend. Unset means every AI button hides | unset (off) |

**Variables that do nothing on this build**, listed so nobody sets one and
waits for an effect: `RESUME_DATA_DIR` (desktop path resolution — use
`RESUME_DB_PATH`), `RESUME_BACKUP_DIR` and `RESUME_BACKUP_INTERVAL_MS` (the sync
scheduler is desktop-only, §1), `RESUME_LOCAL_HOSTNAME` and
`RESUME_LOCAL_PORT` (desktop launcher), `RESUME_NO_UPDATE` and
`RESUME_UPDATE_REPO` (updates are desktop-only, §12).

---

## 12. Upgrading

```bash
cd /srv/resume-studio
# back up first — section 9
git fetch --tags && git checkout v1.2.3
npm ci
npm run build
sudo systemctl restart resume-studio
```

`npm ci`, not `npm install`: the lockfile is authoritative, and a lockfile
regenerated on the server is a different tree from the one that passed CI.

Data-shape migrations run when a resume is loaded and are idempotent, so an
upgrade needs no migration step. **Rolling back is not symmetric**, though: data
saved by a newer build carries a newer `shape_version`, an older build loads it
best-effort, and the stamp is never downgraded. Restore from a backup taken
before the upgrade rather than assuming a downgrade is free.

The server never updates itself, by design — `/api/update` reports
`supported: false` here (§1).

---

## 13. Related documents

| Document | Covers |
|---|---|
| [DESKTOP.md](./DESKTOP.md) | The portable desktop build: launcher, data folders, cloud-folder sync, tray, in-app settings, auto-update |
| [PRIVACY.md](./PRIVACY.md) | What is stored, what leaves the machine, and deleting a person's data |
| [SECURITY.md](./SECURITY.md) | Reporting a vulnerability; what is in and out of scope |
| [README.md](./README.md) | Feature tour and the development quick start |
| [.env.example](./.env.example) | Every environment variable, with its reasoning |
| [`plans/multi-user-auth.md`](./plans/multi-user-auth.md) | The accounts-and-ownership work that ends the single-tenant model in §1 |
