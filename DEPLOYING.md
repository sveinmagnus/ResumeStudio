# Resume Studio — Self-hosted server deployment

This is the **server build**: the same Express + SQLite + React app as the
portable desktop build, run as a long-lived Node service — typically one small
VPS behind a domain name, holding a consultancy's CVs.

[DESKTOP.md](./DESKTOP.md) covers the double-clickable build. That one binds
loopback, needs no certificate, no proxy and no login, and manages itself from
an in-app Settings screen. **None of that applies here.** A server build is
reachable by anyone who can reach the port, and everything below exists because
the app does not defend that port for you.

---

## 1. What this deployment is, and is not

**It has accounts.** The first account created on an instance becomes the
**owner** and claims every résumé already in the database. Everyone after that
arrives by invitation as a **member**: they own what they create, can share a
résumé read-only with the rest of the instance, and can neither read nor write
anything else. The owner reads and writes everything. `server/access.ts` is the
whole rule, written once and asked by the query layer rather than remembered at
eleven call sites. §7 spells out what each role can reach.

**Its authentication mode is derived from the database, not declared.** Any user
row and the instance is in `accounts` mode. No users but `RESUME_API_TOKEN` set
and it is in `token` mode — the pre-accounts behaviour, kept so an existing
server keeps running across the upgrade. Neither, and it is `open`: no
authentication at all. The mode is derived because the alternative is a variable
that can disagree with the database, and the failure of that disagreement is
either a lockout or an open server. §4 is how you leave `open` and `token`
behind.

**Accounts are an access-control boundary, not an encryption one.** Everything
is one unencrypted SQLite file. The owner role reads every CV by design, and so
does anyone with shell access to the box. [PRIVACY.md](./PRIVACY.md) §2 states
that in the terms a person whose CV lives here would ask about; say the same
thing to your colleagues before you invite them.

**It has no TLS of its own.** The server does a plain `app.listen`: no
certificate handling, no HTTP-to-HTTPS redirect. See §5.

**It never updates itself, but it will tell you a release exists.** `/api/update`
reports `supported: false` and its installing routes 403 on any build the
desktop launcher did not wire — a service rewriting its own files while running
is a different proposition from a desktop app doing it. Asking is a different
act from installing, so `POST /api/update/check-only` answers, owner-only and
only when asked: a background poll would make a hosted instance contact GitHub
by default, which is not what [PRIVACY.md](./PRIVACY.md) promises. Upgrading is
§15.

**Its settings live in the environment, with one narrow exception.** The gear
icon is read-only except for the handful of keys a hosted owner genuinely cannot
set any other way — mail, above all, because without it the password-reset email
is unreachable on exactly the deployment that needs it. Those writes do not
survive a restart. §9 is the whole story; everything else is §14.

**It has no continuous sync folder.** `RESUME_BACKUP_DIR` drives the desktop
build's cross-computer sync, and the scheduler and watcher behind it are started
by the desktop launcher only — `server/index.ts` never calls
`initBackupRuntime`. Setting the variable here gets you the manual publish and
restore routes and nothing that calls them, which `GET /api/backup/status`
reports honestly as `continuous: false`. Off-box backups are §12.

---

## 2. Requirements

**Node 24 or newer — a hard floor, not a recommendation.** The database is
Node's built-in `node:sqlite`, which is behind a flag on 22 and below.
`package.json → engines` declares `>=24` and CI enforces it. There is no native
addon anywhere in the tree, so there is nothing to compile and nothing to
rebuild after a Node upgrade. Password hashing is `node:crypto` scrypt and the
SMTP client is hand-rolled over `node:net`/`node:tls`, so adding accounts and
email added no dependencies to install either.

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

1. **The cookies only get their `Secure` flag in production.**
   `server/routes/auth.ts → setCookieValue` builds
   `rs_session=…; Path=/; HttpOnly; SameSite=Strict` and appends `Secure` only
   when `process.env.NODE_ENV === 'production'`; `server/csrf.ts → csrfCookie`
   does the same. Without it, the cookie carrying a live session is sent over
   plain HTTP as readily as over TLS — so anything that can strip TLS, or reach
   the app on an http:// URL, collects a working credential.
2. **The built client is only served in production.** `server/app.ts` resolves
   the client directory as `RESUME_CLIENT_DIR` or, failing that, `../dist`
   *only* when `NODE_ENV` is `production`. Get it wrong and you have a working
   API with no user interface: `/` 404s.

`npm start` sets it. If a supervisor invokes the entry point directly instead,
set it explicitly — see the unit file in §13, which sets it in both places for
that reason.

### `.env` is a fallback; the real environment wins

`server/index.ts` reads a `.env` from the process's **working directory** before
anything consults a variable, with a small parser in `server/env.ts` rather than
a `dotenv` dependency. It applies only keys that are **not already set**, which
is the right way round for a service: a systemd `EnvironmentFile=`, a Docker
`-e` or a CI secret is the deliberate configuration, and a `.env` somebody left
in the checkout is not. A malformed or unreadable file is ignored rather than
fatal, and the boot line reports how many variables it applied and how many the
environment had already answered.

For a supervised deployment prefer `EnvironmentFile=` (§13): it survives a
`git pull`, it does not sit in the working tree, and it is the file you can keep
at `0600` for a reason.

Either way, a configuration that never arrived fails quietly in the direction of
*less* security: on a database with no accounts yet, an unset
`RESUME_API_TOKEN` means no authentication at all (§1), so the instance starts
happily and serves everything.

**Check it after the first boot.** `GET /api/auth/status` names the mode, and it
needs no credential:

```bash
curl -s https://cv.example.com/api/auth/status
```

`{"mode":"accounts",…}` is the destination. `"token"` means the env arrived but
nobody has created an account yet (§4). `"open"` means neither, and the instance
is serving every CV to anyone who asks.

---

## 4. First run: creating the owner account

The first account owns the instance, so "whoever gets there first" is a race a
port scanner wins on a public IP, and the loss is total. Instead the server
prints a **one-time bootstrap code** and you spend it.

### On a fresh instance

Start the server and read stdout, or the log if a supervisor captured it:

```
  ┌─────────────────────────────────────────────────────────────┐
  │  Resume Studio has no accounts yet.                         │
  │  Open the app and use this one-time code to create the      │
  │  first account, which becomes the owner:                    │
  ...
```

Open the app, enter the code, pick a username and password. The code lives in
memory and is never written to disk, so a backup of the database cannot yield
one and **a restart issues a new code** — which is also how you re-issue one if
you lost it. It is spent the moment it succeeds, and
`POST /api/auth/bootstrap` 404s forever after, so the setup screen cannot be
summoned on an instance that already has an owner.

The URL in the banner is the server's own `http://localhost:<port>`, because the
process does not know its public name. Use your real one.

Creating the owner does four things in the same request:

- **Claims every résumé with no owner.** On an upgrade those are all of them.
  Until they are claimed they are readable by owners only, never by members —
  an unowned row must not read as "shared with everybody".
- **Converts each `RESUME_API_TOKENS` entry into a real account** (see below).
- **Prints ten recovery codes, once.** Store them somewhere that is not this
  server. They are the only password reset that needs neither another person nor
  a shell on the box.
- **Signs you in**, setting the session and CSRF cookies.

### On an instance that already uses `RESUME_API_TOKEN`

Nothing changes on upgrade: the token keeps working, and the server prints no
setup code — a banner at every boot of a working server is noise that trains
people to ignore it. When you are ready to migrate, start it once with
`RESUME_SETUP=1`, which issues the code anyway, and create the owner.

**`RESUME_API_TOKENS` (the named tokens) are retired.** They authenticate only
while the instance is in `token` mode. Bootstrap turns each name into a real
member account with a **locked** password — the shared secret that named them
must not go on working as that person's credential — and each one then appears
on the team screen with no way to sign in. From then on the variable
authenticates nothing; remove it from the environment. Give each of those people
a reset link (§8), and they set a password of their own.

A nickname on a shared secret cannot be revoked, cannot expire, and names
whoever holds it rather than a person. That is why they went.

**`RESUME_API_TOKEN` (the single one) stays**, and its meaning narrows: in
accounts mode it is a **service credential**, presented as
`Authorization: Bearer <token>` only. It resolves to a viewer with the owner
role and *no user id* — it sees everything, so scripts, cron and curl work, but
it is not a person: it owns nothing, and a résumé it creates is left unowned.
Keep it set if anything automated talks to this instance; the nightly backup in
§12 is exactly that case, and after bootstrap there is no other non-interactive
way in.

---

## 5. TLS: terminate it in a reverse proxy

The app speaks HTTP only. Put Caddy, nginx or Traefik in front and let it own
the certificate.

This is not a formality. `POST /api/auth/login` carries a password in a
plaintext JSON body, and every request afterwards carries a live session id back
in the `rs_session` cookie. Unencrypted, on a public network, that is one
person's password and then the session it bought, repeated on every request, to
anyone on the path.

### Caddy

Caddy obtains and renews a Let's Encrypt certificate by itself, which is why
this is the whole configuration:

```caddy
cv.example.com {
	reverse_proxy 127.0.0.1:3001
}
```

Caddy sets `X-Forwarded-For` and `X-Forwarded-Proto` on its own, so pair this
with `RESUME_TRUST_PROXY=1` (§6).

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

`GET /api/health` sits outside the auth middleware, the CSRF check and the rate
limiter, so an upstream check or an uptime monitor can poll it without a
credential and without spending a limiter slot. It answers `{"ok":true}` and
touches no database — it reports that the process is up, not that the data is
readable.

### What the app already sends, and what to leave alone

Every response carries a Content-Security-Policy plus `X-Content-Type-Options`,
`X-Frame-Options: DENY`, `Referrer-Policy` and `Permissions-Policy`
(`server/app.ts`). The CSP is tuned to what this SPA actually needs — inline
`<style>` blocks, `blob:` image URLs for the photo cropper, `connect-src 'self'`
because every provider call is proxied server-side. **Do not add a second CSP at
the proxy.** Two policies intersect, and a generic one will break the editor.

Two request headers are load-bearing and must reach the app unmodified. Every
state-changing request from the browser carries an `X-CSRF-Token` header that
has to match the readable `rs_csrf` cookie (`server/csrf.ts`), and `app.ts`
rejects a write whose `Sec-Fetch-Site` the browser reported as `cross-site`. A
proxy that strips unknown headers breaks every save; one that invents a
`Sec-Fetch-Site` breaks the guard. Neither Caddy nor the nginx block above does
either.

The one header worth adding at the proxy is HSTS. The app cannot send it
sensibly: it does not know whether it is behind TLS.

---

## 6. `RESUME_TRUST_PROXY` — set it whenever there is a proxy

Behind a proxy, the socket peer of every connection is the proxy. `req.ip`
collapses to a single address for the entire internet, and all three rate
limiters (§10) key on `req.ip`. One attacker's failed-login flood then fills the
one shared bucket and returns 429 to **everybody** — the brake becomes the
denial of service it was meant to prevent.

Setting `RESUME_TRUST_PROXY` makes Express read `X-Forwarded-For`, so the
limiters key on the real client again. Accepted values (`server/app.ts`):

| Value | Meaning |
|---|---|
| `1`, `2`, … | A **hop count** — how many proxies in front of the app you control, counted back from it. One nginx or Caddy is `1`; a CDN in front of that is `2`. |
| `true` | Trust the whole chain. Correct only when nothing but your proxy can reach the app port; otherwise a client sets its own `X-Forwarded-For` and chooses which rate-limit bucket to fill. |
| anything else | Handed to Express verbatim as its `trust proxy` setting — a preset such as `loopback`, or an IP/subnet list. |

It is **off by default**, and that default is right for dev and for the desktop
build: a directly-bound server must never believe a header the client wrote.

The limiter key is the *only* thing this affects here — the app reads no other
forwarded value. In particular the cookies' `Secure` flag comes from `NODE_ENV`
and not from `X-Forwarded-Proto`, so §3's rule stands on its own and this
setting does not substitute for it.

---

## 7. Accounts, roles and what each can reach

Two roles, and the difference is the whole access model.

| | member | owner |
|---|---|---|
| Résumés they created | read, write, rename, delete, share, export | same |
| Another member's private résumé | invisible — a 404, identical to one that does not exist | read and write |
| A résumé shared with the instance | **read only** | read and write |
| The shared skill / role / industry registry | read, add to, rename | plus delete an entry |
| Accounts | their own profile, password and recovery codes | invite, rename, disable, promote, mint reset links |
| Reassigning a résumé's owner | — | `POST /api/resumes/:id/owner` |
| `GET /api/backup/export` | the résumés they **own** | the whole instance |
| `POST /api/backup/restore` | 403 | allowed |

**Private by default, and refusal is indistinguishable from absence.** A résumé
another member may not read answers exactly as one that does not exist, so the
API cannot be walked to find out who has a CV here.

**Sharing grants reading, never writing.** A member who could write a shared
résumé could silently rewrite a colleague's history, and "share with the team"
has to be safe to switch on. `canWrite` is ownership or the owner role, full
stop; `canReshare` follows the same rule, so a member cannot share a colleague's
CV on their behalf.

**The owner reads everything, including private résumés.** Deliberate, not an
oversight: staffing work means reading across the firm, a backup has to cover
everything, and a colleague who leaves takes their password with them but not
their CV.

**The registry is not scoped, on purpose.** Skill, role and industry names are
one shared vocabulary — that is what makes "who here knows Kubernetes?"
answerable, and a per-member registry is just a per-member spelling of
"Kubernetes". So **a skill named after a client is visible to everyone on the
instance**; tell people that before they name one. Delete is the exception and
is owner-only, because it rewrites references across résumés the deleter may not
be able to see, so its blast radius is not bounded by what they can read.

### Sessions

`POST /api/auth/login` exchanges a password for an HttpOnly `rs_session` cookie
carrying an **opaque random id**; the `sessions` table stores only its SHA-256,
so a copy of the database yields no way in. The client never reads the cookie
and could not — page JavaScript, and therefore any XSS, cannot see an HttpOnly
value.

Sessions have **no expiry timer**. They end when something makes them
untrustworthy: signing out, a password change, a password reset, or the account
being disabled. A password change ends *every* session for that account,
including the one that changed it. Revocation on those four events is a stronger
guarantee than a clock, and it does not ask somebody mid-edit to sign in again
for no reason.

The pre-accounts `rs_token` cookie is cleared on login and logout and is never
read. A browser holding a stale one gets a clean 401 rather than an ambiguous
lookup against the sessions table.

A bearer token is read from the `Authorization` header and nowhere else, so a
stolen session id cannot be replayed as one. (The exception is an instance still
in `token` mode, where the cookie carries the token itself — there is no session
table to key on until accounts exist.)

### Rotation and revocation

Disabling an account ends its sessions immediately and stops it signing in
again. The last remaining owner cannot be disabled or demoted — that refusal is
what stops an instance locking everybody out of its own administration.

Accounts are **disabled, never deleted**; erasing a person is two deliberate
acts, and [PRIVACY.md](./PRIVACY.md) §6 gives the order.

Rotating `RESUME_API_TOKEN` still means editing the environment and restarting.
It is a shared secret with no revocation list, which is precisely why people get
accounts and only scripts get this.

---

## 8. Getting back in

Four ways to reset a password, and they are four ways to mint the same
short-lived grant. One redemption path, so four triggers cannot become four
classes of bug.

1. **A recovery code.** Ten are printed once when an account is created and can
   be regenerated from the profile screen. Single use, and they need neither
   another person nor access to the server. This is the one to file away.
2. **The owner mints a reset link** for any account and hands it over out of
   band. Also how a converted legacy-token account gets its first password (§4).
3. **An emailed reset link**, if mail is configured (§9). `/forgot` answers
   identically whether or not the account exists, has an address, or has
   verified it — anything else turns the reset form into a "does this person
   have an account here" oracle, which for a CV tool is itself the sensitive
   answer.
4. **Recovery mode on the box**, for the owner who has none of the above. There
   is nobody above the owner, so without this an instance can lock its
   administrator out permanently.

```bash
cd /srv/resume-studio
sudo -u resumestudio npm run recover                  # list the accounts
sudo -u resumestudio env RESUME_APP_BASE_URL=https://cv.example.com \
  npm run recover -- kari                             # mint a reset link
```

The link is valid for 30 minutes, works once, and ends every existing session
for that account when spent.

Run it **as the service user, with the same environment the service gets**. The
script opens the database the environment points at, so a run with the wrong
`RESUME_DB_PATH` — or as a user who cannot read the file — reports "no accounts
exist yet" about a database that is not yours. Without `RESUME_APP_BASE_URL` the
link is printed against `http://localhost:3001`, which is fine to paste into a
browser on the box and useless anywhere else.

This grants nothing new. Running it requires the ability to execute a command on
the machine holding `resume.db`, and anyone who can do that can already read
every CV in it with `sqlite3`. What changes is that recovering is a supported
action rather than a hand-edit of the users table.

---

## 9. Email — optional, and off until you configure it

Mail exists for one thing: the self-service password reset in §8. **No CV
content ever reaches it.** Leave it off and the "Forgot password?" link is
hidden rather than shown and broken — a disabled control advertises a feature
while refusing it.

Two transports, both dependency-free:

- **`sendmail`** — `execFile` on the local binary (`/usr/sbin/sendmail` by
  default), argv only, message on stdin. If the box already has a working MTA
  this is the whole configuration.
- **`smtp`** — a hand-rolled client over `node:net`/`node:tls`: implicit TLS
  (465), STARTTLS (587) or a plain local relay (25), with AUTH PLAIN/LOGIN.

Set `MAIL_TRANSPORT`, `MAIL_FROM` and the transport's own variables (§14). The
transport is **declared, never sniffed** — a misdetected mail path is silent
until the one moment somebody needs a reset link. An unusable `MAIL_FROM` counts
as unconfigured, because it is a header value the send path would refuse anyway,
and failing there means failing *after* a user was offered the link.

**`RESUME_APP_BASE_URL` is required for any link to be sent at all.** A reset
link has to be absolute, and one built from the request's `Host` header is a link
whoever sent the request chooses — pointed at their own server, it collects the
credential instead of delivering it. So the app refuses to guess: no base URL,
no mail, and no emailed invitations either.

`/forgot` only sends when the account exists, is enabled, has an address, **and
that address is verified**. An owner may type a colleague's address into their
profile, but only the colleague clicking the verification link proves it reaches
them.

### Configuring it from inside the app

Mail is what a hosted operator can set through the gear icon, because a server is
exactly the deployment where the reset email matters and exactly the one where
editing the environment means a restart. `GET /api/settings` reports
`managed: false` here, plus an `editable_keys` list; an **owner** may write only
those keys (`server/routes/settings.ts → OWNER_EDITABLE`):

```
mail_transport  mail_from  sendmail_path
smtp_host  smtp_port  smtp_security  smtp_user  smtp_pass
app_base_url
user_username  user_display_name  user_email
```

The last three are the desktop build's local identity, writable here because the
list is one list; on an instance with accounts they take effect nowhere (§14).
Anything else — the sync folder, the local hostname, ports, the AI and
translation providers — is a property of the machine, and a web request that
could move one is how an instance talks itself off the network. A patch touching
even one refused key is rejected whole, naming it, rather than half-applied. A
member gets a 403 on all of it.

**Two limits worth knowing before you rely on this.**

The write lands in `settings.json` under the data directory and is pushed onto
`process.env` immediately, so it takes effect with no restart. But the server
build **never reads that file back at boot** — only the desktop launcher calls
`loadOrInitSettings()`, and `currentSettings()` on a server is synthesised from
the environment. So an in-app mail configuration lasts exactly as long as the
process. Use it to get a locked-out colleague back in today; put the same values
in the environment if they should survive a restart.

And the data directory is where that file goes: `RESUME_DATA_DIR`, or failing
that a per-user OS folder such as `~/.local/share/resume-studio`. Under the
hardened unit in §13 that folder is not writable, and the save fails with a 500.
Point `RESUME_DATA_DIR` at a path listed in `ReadWritePaths` if you want the
screen to work at all.

---

## 10. Rate limiting

Three limiters, all keyed by IP (which is why §6 matters).

**The API limiter** — `RESUME_RATE_LIMIT_MAX` (default `50`) per
`RESUME_RATE_LIMIT_WINDOW_MS` (default `900000`, 15 minutes). It runs on every
`/api` router *before* `authMiddleware`, and on `/api/auth` too, so login
failures are counted.

It sets `skipSuccessfulRequests`, and that is the whole design: **only responses
of status 400 and above consume the budget.** A consultant editing a CV is a
steady stream of 2xx auto-save PUTs, roughly one per second, that never
accumulates against the window; somebody guessing a password accumulates on
every attempt. So this brakes brute force and bad-request floods without ever
throttling legitimate work.

The practical consequence: if users report 429s, raising the maximum is almost
certainly the wrong fix. Normal editing costs nothing, so a filled bucket means
either a real attack or a client generating errors — find out which.

**The translate limiter** — `RESUME_TRANSLATE_RATE_LIMIT_MAX` (default `60`) per
`RESUME_TRANSLATE_RATE_LIMIT_WINDOW_MS` (default `60000`, one minute) — applies
additionally to `/api/translate`, `/api/summarize` and `/api/llm`, and counts
**successful** calls too. A successful call against a paid DeepL, OpenAI or
Azure key costs money, so without it a leaked credential could run up the
provider bill at wire speed. The default sits far above human drafting pace.

**The recovery limiter** — `RESUME_RECOVERY_RATE_LIMIT_MAX` (default `5`) per
`RESUME_RECOVERY_RATE_LIMIT_WINDOW_MS` (default `900000`, 15 minutes) — covers
`/api/users/forgot`, `/reset`, `/recover` and `/accept`, and also counts
successes. It exists because `/forgot` answers 200 in every case *by design*
(§8), so under the failure-focused main limiter it would never spend its budget:
the one endpoint that makes the server send email to an address of the caller's
choosing would be the one endpoint with no ceiling. That is a mail bomb aimed at
a third party and a fast route to this server's IP landing on a blocklist.

Deliberately tight. A human forgets a password a handful of times an hour, never
fifty.

---

## 11. The database, and where it must not live

The SQLite file lives at `data/resume.db`, resolved relative to the server
module rather than the working directory, so it lands beside `server/` in the
checkout. `RESUME_DB_PATH` overrides it with an exact path. (`RESUME_DATA_DIR`
does **not** move it — on this build that variable decides only where
`settings.json` is written; see §9.)

One file holds everything: every résumé, up to 50 snapshots per résumé in
`resume_snapshots` (`ON DELETE CASCADE`), and the four account tables — `users`,
`sessions`, `grants` and `recovery_codes`. **The in-app History feature is not a
backup** — it lives inside the file you are trying to protect. That is what §12
is about.

At boot the file is `chmod`'ed to `0600` and `data/` to `0700` where the OS
supports it. That is only worth something if the service runs as its own
unprivileged user (§13).

Passwords are stored as scrypt hashes and every token the app hands out
(sessions, invites, resets, recovery codes) is stored as a SHA-256 of a
high-entropy random value. So a leaked database file is a disclosure of every
CV — which is the thing worth protecting — but not a set of working credentials.

### Never put the live database on a synced or network volume

WAL mode leaves long-lived `-wal` and `-shm` sidecar files. A cloud-sync client
(Drive, Dropbox, OneDrive) or a flaky network filesystem uploads or flushes
those pieces at inconsistent moments, and the result is a database that no
longer opens. The server opens the file before it listens, so a damaged one
prints the same recovery note the desktop launcher gives and exits 1 rather than
degrading into a 500 on whichever request first touches storage. That is the
correct failure and not a soft one: the service is down until you restore §12.

If you genuinely have no choice — the only writable volume is an NFS mount, say
— `RESUME_DB_JOURNAL=TRUNCATE` keeps everything inside the single `.db` file
between transactions, leaving no sidecars for a sync client to tear. It is the
documented escape hatch, not a recommendation: it removes the sidecars, not the
hazard of two machines writing the same file. `WAL`, `TRUNCATE`, `DELETE`,
`PERSIST`, `MEMORY` and `OFF` are accepted; anything else falls back to `WAL`.

---

## 12. Off-box backups

`data/resume.db` is the only copy of the data, and the snapshot history a user
would restore from is inside it. Lose the file and you lose the history that
would have recovered it. Nothing in the server build writes a second copy on its
own.

The supported route is **`GET /api/backup/export`**: a zip holding one JSON file
per résumé plus `resume-studio-registry.json` — the same layout the desktop sync
folder uses. It is auth-gated, available on every build, and needs no configured
folder. **An owner gets the whole instance; a member gets the résumés they own**
and not the ones merely shared with them, because reading a colleague's shared CV
in the app and taking a copy off the machine are different acts.
`POST /api/backup/import` takes that zip (or one résumé file out of it) back and
merges **by résumé id**, so restoring updates résumés in place and never mints
duplicates — scoped the same way, so an upload cannot rewrite rows the caller
does not own.

Pull it from somewhere that is not the server, which is the whole point. This is
the case `RESUME_API_TOKEN` still exists for (§4) — a cron job has no browser to
sign in with:

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
touches the failure-focused limiter (§10).

Restoring: drop the zip on the résumé picker, or

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $RESUME_API_TOKEN" \
  -H 'Content-Type: application/zip' \
  --data-binary @resume-studio-2026-08-20.zip \
  https://cv.example.com/api/backup/import
```

**A backup carries ownership but not accounts.** Each file records its résumé's
`owner_id` plus a descriptive `author` (username, display name, email), and no
users at all. Restoring into the *same* instance therefore keeps ownership
intact; restoring into a fresh one cannot — an owner id naming nobody here is
ignored, and each résumé falls to whoever ran the restore, which for the service
token above means nobody, leaving them owner-visible and member-invisible.
`POST /api/resumes/:id/owner` is how an owner puts each one back where it
belongs — a file cannot prove who wrote it, so a person decides rather than the
import guessing permanently. Two more things a restore does not carry back: an
existing résumé's owner is never reassigned by a merge, and a restored row is
always `private`, so a résumé that had been shared with the instance is shared
again by hand.

A file-level copy of `data/resume.db` is the second line, and the only one that
also captures the accounts. Take it from a stopped service, or through
`sqlite3 data/resume.db ".backup '/path/out.db'"`. Copying a live WAL database
with `cp` copies a torn file, which is the failure mode §11 describes.

Test a restore into a scratch instance at least once. An untested backup is a
hypothesis.

---

## 13. A systemd unit

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

# The deliberate configuration, and it beats any .env in the checkout (section
# 3). Keep the file 0600; it holds the API token and any SMTP password.
EnvironmentFile=/etc/resume-studio.env

# Also set by `npm start`. Stated here too so that changing how the service is
# launched cannot silently drop the cookies' Secure flag.
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
ReadWritePaths=/srv/resume-studio/data /srv/resume-studio/state /srv/resume-studio/.npm

[Install]
WantedBy=multi-user.target
```

`/etc/resume-studio.env`:

```
PORT=3001
RESUME_API_TOKEN=<openssl rand -hex 32>
RESUME_TRUST_PROXY=1
RESUME_APP_BASE_URL=https://cv.example.com
RESUME_DATA_DIR=/srv/resume-studio/state
```

`ProtectSystem=strict` makes the whole filesystem read-only except what
`ReadWritePaths` names, which is the useful shape here: the service writes
`data/` (the database) and `state/` (the in-app settings file, §9).
`ProtectHome=true` is why `RESUME_DATA_DIR` has to be set — the default data
directory is under the service account's home, which this unit makes
unreachable. Deployments (`git pull`, `npm ci`, `npm run build`) happen outside
the unit, as a user who can write the checkout.

The bootstrap code in §4 goes to stdout, so `journalctl -u resume-studio` is
where you read it.

---

## 14. Configuration reference

The server build's variables. `.env.example` documents the translation and
AI-assist providers in more detail.

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | Must be `production` — `Secure` cookie flag **and** serving the built client (§3) | unset |
| `PORT` | Listen port | `3001` |
| `RESUME_SETUP` | `1` issues a bootstrap code on an instance still authenticating with `RESUME_API_TOKEN` (§4) | unset |
| `RESUME_API_TOKEN` | Service credential for scripts and cron: Bearer only, owner-level, owns nothing. **Empty means no authentication until the first account exists** (§1) | empty |
| `RESUME_API_TOKENS` | Retired. Authenticates only until the first account exists; bootstrap converts each name into a locked account (§4) | empty |
| `RESUME_APP_BASE_URL` | Absolute public base URL. Required before any reset, invite or verification link can be sent (§9); also where `npm run recover` points its link (§8) | unset |
| `RESUME_TRUST_PROXY` | Trust `X-Forwarded-For` for the rate-limiter key: hop count, `true`, or an Express preset (§6) | off |
| `RESUME_RATE_LIMIT_MAX` / `_WINDOW_MS` | Failure-focused API limiter (§10) | `50` / `900000` |
| `RESUME_TRANSLATE_RATE_LIMIT_MAX` / `_WINDOW_MS` | Success-inclusive limiter on translate / summarize / LLM (§10) | `60` / `60000` |
| `RESUME_RECOVERY_RATE_LIMIT_MAX` / `_WINDOW_MS` | Success-inclusive limiter on the reset and invite routes (§10) | `5` / `900000` |
| `RESUME_DB_PATH` | Exact database file | `<checkout>/data/resume.db` |
| `RESUME_DB_JOURNAL` | SQLite journal mode; `TRUNCATE` is the synced-volume escape hatch (§11) | `WAL` |
| `RESUME_DATA_DIR` | Where `settings.json` is written. **Not** the database (§9, §11) | per-user OS app-data folder |
| `RESUME_CLIENT_DIR` | Where the built client lives | `<checkout>/dist` when `NODE_ENV=production` |
| `MAIL_TRANSPORT` | `off` / `sendmail` / `smtp` (§9) | `off` |
| `MAIL_FROM` | Envelope sender and `From:`. An invalid address counts as unconfigured | empty |
| `SENDMAIL_PATH` | Local sendmail-compatible binary | `/usr/sbin/sendmail` |
| `SMTP_HOST` / `SMTP_PORT` | Relay host; `0` means the standard port for the security mode | empty / `0` |
| `SMTP_SECURITY` | `tls` (465), `starttls` (587) or `none` (a local relay) | `starttls` |
| `SMTP_USER` / `SMTP_PASS` | Empty user means no AUTH is attempted | empty |
| `TRANSLATE_PROVIDER` + provider keys | Translation backend (`off`/`libretranslate`/`deepl`/`google`/`azure`/`llm`) | unset (off) |
| `LLM_PROVIDER` / `LLM_MODEL` / `LLM_HIGH_END` + provider keys | AI-assist backend. Unset means every AI button hides | unset (off) |

**Narrower than they look:** `RESUME_BACKUP_DIR` enables the manual
`/api/backup/now`, `/restore` and `/status` routes and the deletion tombstone,
but nothing calls them on a schedule (§1). `RESUME_UPDATE_REPO` still chooses
which GitHub repository `/api/update/check-only` asks about, even though nothing
here can install what it finds. `RESUME_USER_USERNAME`,
`RESUME_USER_DISPLAY_NAME` and `RESUME_USER_EMAIL` name the person at the
keyboard on an install with no accounts and no token — on a server that is a
state you should not be in, so they take effect nowhere.

**Variables that do nothing at all on this build**, listed so nobody sets one
and waits for an effect: `RESUME_BACKUP_INTERVAL_MS` (no scheduler runs),
`RESUME_LOCAL_HOSTNAME` and `RESUME_LOCAL_PORT` (desktop launcher), and
`RESUME_NO_UPDATE` (it gates the launcher's updater, not the check route).

---

## 15. Upgrading

```bash
cd /srv/resume-studio
# back up first — section 12
git fetch --tags && git checkout v1.2.3
npm ci
npm run build
sudo systemctl restart resume-studio
```

`npm ci`, not `npm install`: the lockfile is authoritative, and a lockfile
regenerated on the server is a different tree from the one that passed CI.

Data-shape migrations run when a résumé is loaded and are idempotent, so an
upgrade needs no migration step; the account tables are created on demand by
`CREATE TABLE IF NOT EXISTS`, so an instance that has never had accounts gains
them without doing anything. Authentication behaviour does not change on
restart either — a token instance stays a token instance until you deliberately
run §4.

**Rolling back is not symmetric.** Data saved by a newer build carries a newer
`shape_version`, an older build loads it best-effort, and the stamp is never
downgraded. Rolling back past the release that introduced accounts leaves the
new tables in place and unread, which is harmless, but the résumés they own are
readable by everyone again — the ownership columns mean nothing to a build that
does not consult them. Restore from a backup taken before the upgrade rather
than assuming a downgrade is free.

The server never installs an update itself, by design — `/api/update` reports
`supported: false` here (§1). `POST /api/update/check-only` is how an owner
finds out a release exists; the sequence above is how it gets applied.

---

## 16. Related documents

| Document | Covers |
|---|---|
| [DESKTOP.md](./DESKTOP.md) | The portable desktop build: launcher, data folders, cloud-folder sync, tray, in-app settings, auto-update |
| [PRIVACY.md](./PRIVACY.md) | What is stored, who on a shared instance can read a résumé, what leaves the machine, and deleting a person's data |
| [SECURITY.md](./SECURITY.md) | Reporting a vulnerability; what is in and out of scope |
| [README.md](./README.md) | Feature tour and the development quick start |
| [.env.example](./.env.example) | Every environment variable, with its reasoning |
