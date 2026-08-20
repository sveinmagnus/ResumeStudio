# Multi-user Resume Studio — implementation plan

Status: **planned, not started.** Delete this file when the work ships; the
deliberation belongs in git history, not in `plans/` (CLAUDE.md §12).

Today the server authenticates a *secret*, not a person. `RESUME_API_TOKEN`
gates the API; `RESUME_API_TOKENS` optionally attaches a nickname to a token,
and `server/auth.ts` says what that is worth in its own comment — *"attribution,
not authentication"*. No query is scoped: `listResumes()` is
`SELECT id, name, data FROM resumes ORDER BY saved_at DESC`, so every holder of
a valid token sees every CV. That is correct for one person or a fully trusting
team, and unusable for a firm where consultants should not read each other's
CVs.

This plan introduces the user model, then the authorization that depends on it.

---

## Decisions already taken (do not re-litigate)

1. **Resumes are private by default.** New `visibility` column, default `private`.
2. **The `owner` role sees everything.** Needed for staffing work, for backups,
   and for recovering a departed colleague's CV. PRIVACY.md must say so plainly.
3. **The desktop build stays account-free.** One person, own machine, loopback —
   a login screen there is pure friction. Gated by the existing `isDesktop()`.
4. **`RESUME_API_TOKEN` survives** as a service credential mapped to an owner-
   equivalent viewer, so tests, CI, curl and scripts keep working.
5. **Password reset has four triggers and one mechanism** (§4) — three that
   need no email at all, plus optional self-service email (§3b).

## Non-goals

OIDC/SSO, TOTP/2FA, a general RBAC matrix, per-field ACLs, and a full PWA.
Each is addable later; none is needed to make the product multi-user.

**Email is in scope but strictly optional** (§3b): off by default, two
dependency-free transports, and the only feature it unlocks is self-service
password reset. The app never emails anything else, and never sends CV content.

## Inherited constraints

- **No new npm dependencies.** Password hashing is `node:crypto`'s `scrypt`
  (measured on the dev box: 42 ms at N=16384, 292 ms at N=131072). `bcrypt` and
  `argon2` are both native addons and collide with the closed decision in
  `open-items.md` §3.
- **Additive migrations only**, using the existing `db.ts` idiom:
  `CREATE TABLE IF NOT EXISTS` plus `PRAGMA table_info` → `ALTER TABLE ADD
  COLUMN`. Same pattern as `version` and `saved_by`.
- Storage stays `node:sqlite` behind `server/sqlite.ts`. Foreign keys are
  already on (the snapshot cascade needs them), so `ON DELETE CASCADE` works.
- The desktop build must not regress in any phase.

---

## Phase 0 — deployment hardening (no code, ship independently)

None of this waits for the rest, and the current single-tenant model is not
safely internet-facing without it.

- **TLS.** The server does a plain `app.listen`; there is no HTTPS path. Put
  Caddy/nginx/Traefik in front. The password crosses the wire in the login body.
- **`NODE_ENV=production`**, or the session cookie never gets its `Secure` flag
  (`routes/auth.ts → setCookieValue`).
- **`RESUME_TRUST_PROXY=1`** behind that proxy. Without it every request keys to
  the proxy's IP and one attacker's failed-login flood 429s everybody.
- **Off-box backups.** `data/resume.db` is the only copy and snapshots live
  inside it. `GET /api/backup/export` is the supported route.
- **Never put the DB on a synced/network volume** (WAL corruption).
  `RESUME_DB_JOURNAL=TRUNCATE` is the documented escape hatch.

**Effort: an afternoon.** Document it in DESKTOP.md's sibling — a new
`DEPLOYING.md`, since DESKTOP.md is about the portable build.

---

## Phase 1 — identity core

### Schema (all additive)

```sql
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,      -- see open decision D1
  display_name  TEXT NOT NULL,
  pw_hash       TEXT NOT NULL,             -- self-describing, see below
  role          TEXT NOT NULL DEFAULT 'member',   -- 'owner' | 'member'
  email         TEXT,                      -- optional; only used for reset (3b)
  email_verified_at TEXT,                  -- null = cannot receive resets (D5)
  created_at    TEXT NOT NULL,
  last_login_at TEXT,
  disabled_at   TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash      TEXT PRIMARY KEY,           -- sha256 of the cookie value
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

-- One table behind all invite/reset flows. See §4.
CREATE TABLE IF NOT EXISTS grants (
  token_hash TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,                -- 'invite' | 'reset'
  user_id    TEXT,                         -- null for an invite (no user yet)
  role       TEXT,                         -- invites only
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

CREATE TABLE IF NOT EXISTS recovery_codes (
  code_hash TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  used_at   TEXT
);
```

### Password hashing

`scrypt`, **async** — `scryptSync` at N=131072 blocks the event loop for ~290 ms,
which would stall auto-save for every other user on the box. Recommend
N=32768, r=8, p=1 (~85 ms) as the starting point.

Store self-describing so the parameters can be raised later without
invalidating anyone: `scrypt$N=32768,r=8,p=1$<salt-b64>$<hash-b64>`. Verify
using the *stored* parameters, and transparently re-hash on the next successful
login when they are below current. Compare with `timingSafeEqual`.

Policy: minimum 12 characters, no composition rules (current NIST guidance).
No strength meter, no dependency.

### Sessions

- Cookie value is `randomBytes(32)` base64url. The table stores **sha256 of it**,
  so a database leak yields no live sessions. The id is already high-entropy, so
  a plain hash is right here — a KDF would be cargo cult.
- This closes the residual the security skill already names: *"if a server-side
  session table ever appears, switch the cookie to an opaque id so the
  long-lived secret isn't in the cookie at all."*
- **Rename the cookie** `rs_token` → `rs_session`, and clear `rs_token` on
  login. An old cookie then fails to resolve to a session and produces a clean
  401 rather than an ambiguous one.
- Absolute expiry 30 days, idle expiry 14 days since `last_seen_at`.
- **Throttle the `last_seen_at` write**: update at most once per 5 minutes.
  Auto-save fires roughly per second per editor; a write per request would be
  brutal on a single-writer SQLite file. This is easy to get wrong and invisible
  when you do.
- Logout deletes the row. Password reset and account-disable delete *all* rows
  for that user — real revocation, which an env-var token can never offer.

### Bootstrap — the zero-configuration part

First start with an empty `users` table: the server mints a one-time bootstrap
code, prints it to stdout and `resume-studio.log`, and holds it **in memory**
(a restart re-issues, so a code cannot leak from disk). The UI shows a "Set up
your account" screen taking the code plus username, display name and password.
On success, in one transaction: create the user with `role='owner'` and set
`owner_id` on every resume where it is null.

That handles both the fresh install and the upgrade path, and adds nothing to
`.env`. The route 404s once any user exists.

**Do not** ship "first visitor becomes the owner". On a public IP that is a race
you lose to a port scanner.

**Effort: ~1 day.**

---

## Phase 2 — authorization and scoping (the bulk, and the risk)

### The model

- **member** — full CRUD where `owner_id = me`; read-only where
  `visibility = 'instance'`.
- **owner** — everything.

One column decides the cross-visibility question that the who-knows-what matrix
and the shared registries depend on: those features aggregate *whatever the
viewer can see*, so they degrade correctly with no special-casing. A member sees
themselves plus shared CVs; an owner sees the firm.

### Make scope impossible to forget

Every `ResumeDb` method takes a required `Viewer` (`{ userId, role }`) rather
than reading an ambient. The compiler then flags every call site that has not
thought about it — the same discipline as `mutate()` in the store and
`lib/lookup.ts` for map reads: put the safe path where the unsafe one used to be
so forgetting is a type error, not a silent leak.

**11 `ResumeDb` methods** need it: `listResumes`, `createResume`, `getResume`,
`saveResume`, `deleteResume`, `renameResume`, `listSnapshots`, `getSnapshot`,
`storageStats`, `dumpResumes`, `restoreResumes`.

**19 routes** need an authorization decision: 9 in `routes/resume.ts`, 5 in
`routes/backup.ts`, 5 in `routes/registry.ts`.

### Registry

Stays instance-wide and writable by any member — it holds skill and role
*names*, not personal data, and scoping it would break the feature that
justifies it. **Delete** becomes owner-only (it rewrites references across
resumes the deleter may not be able to see). Flag in PRIVACY.md that a registry
name is visible to everyone, since a skill can be named after a client.

**Effort: 1–2 days.** This is the part that must not be rushed; the failure mode
is silent and it is a data leak.

---

## Phase 3 — account lifecycle

- **Invite** — owner mints a single-use, expiring link; the invitee opens it and
  sets their own password. No email, no SMTP: the link travels by whatever
  channel the firm already uses.
- **Disable** — sets `disabled_at` and deletes the user's sessions. Their
  resumes stay (owned by a disabled user, visible to the owner), because
  deleting a departing colleague's CV should be a separate, deliberate act.
- **Role change** — owner only; an owner cannot demote themselves if they are
  the last owner.
- **Recovery codes** — ten `randomBytes(8)` codes generated at account creation,
  shown **once**, stored as hashes, single-use. "Regenerate" invalidates the old
  set. Offered to every user, owner and member alike.

### §4 — Password reset: three triggers, one mechanism

The decision was to build all three paths. The way that does not become three
classes of bug is to make them three *triggers* on one *redemption*:

```
mintGrant(kind, userId?, ttl)  →  a token, stored hashed in `grants`
redeemGrant(token)            →  { user_id, action } | null
```

Everything below only differs in who calls `mintGrant` and how the token
reaches the human:

| Trigger | Who mints | How it travels | For |
|---|---|---|---|
| Owner-issued reset link | Owner, in the admin panel | Copied out of band | Members |
| Recovery code | The user, at signup | Their password manager | Anyone |
| Recovery mode | `npm run recover`, or `RESUME_RECOVERY=1` + restart | stdout / `resume-studio.log` | Owner floor |
| **Self-service email** (§3b) | The user, from the login screen | sendmail or SMTP | Anyone, when email is configured |

The fourth is why the single-mechanism design earns its keep: email adds a
*trigger*, not a second notion of what a reset is.

**Recovery mode** exists because the owner has nobody above them. It grants
nothing new: whoever can run a command on that server, or read its log, can
already read `data/resume.db`. This is what Grafana, Gitea and Discourse do.
Two triggers so it works both where you have a shell and where you can only set
an env var and restart (PaaS). Both mint an ordinary `reset` grant, so the
redemption path is the one already tested.

Redemption always: verify unused and unexpired → mark used → set the new
password → **delete every session for that user**.

**Effort: ~1 day.**

---

## Phase 3b — optional email (self-service reset)

The other three triggers all need somebody: the owner, or shell access, or a
code you filed away in advance. Email is the one that lets a user who has none
of those get back in alone. It is **off by default** and adds exactly one
feature — a "Forgot password?" link on the login screen. Nothing else in the app
ever sends mail.

### Two transports, both dependency-free

- **`sendmail`** — `execFile('/usr/sbin/sendmail', ['-t', '-i'])` and write the
  message to stdin. No shell, argv only, matching how `localHost.ts` does its
  privileged work: no user-supplied text ever reaches a command line. An hour's
  work where the binary exists.
- **SMTP** — hand-rolled over `node:net` + `node:tls`. SMTP is a line protocol;
  EHLO → STARTTLS → AUTH PLAIN/LOGIN → MAIL FROM → RCPT TO → DATA → QUIT is
  roughly 200 lines. Supports implicit TLS (465) and STARTTLS (587). This is the
  same trade as scrypt over bcrypt: a bounded amount of our own code instead of
  a dependency, in a codebase that has already made that call twice.

Selection is explicit (`mail_transport: off | sendmail | smtp`), never sniffed —
the same rule as `llm_high_end` and the release channel. A misdetected mail path
fails silently at the worst possible moment.

### Configuration — the first thing the owner role unlocks

New `FieldSpec` entries in `server/settings.ts`: `mail_transport`, `smtp_host`,
`smtp_port`, `smtp_security`, `smtp_user`, `smtp_pass` (`kind: 'secret'`, so
`toView` reports `smtp_pass_set: true` and never echoes it), and `mail_from`.
Adding a field means touching all seven consumers in lockstep — the file's own
header comment says so, and cites the bug that proved it.

`/api/settings` currently 403s off the desktop build (`isDesktop()`). Change the
gate to `isDesktop() || viewer.role === 'owner'`, and restrict a server owner to
the mail fields — the sync-folder and local-hostname fields stay desktop-only,
because they mean nothing on a VPS.

With `mail_transport: 'off'` the "Forgot password?" link is **hidden**, not
disabled — the same rule the AI surface follows. A disabled control advertises a
feature while refusing it.

### The security work, which is most of this phase

1. **Header injection is the headline risk.** The address lands in a `To:`
   header; a CR or LF in it injects further headers (a `Bcc:`, or a second
   body). **Reject, never sanitise** — the `server/resumeId.ts` precedent, and
   the same instinct as `npm run check:text`. Strict address charset, no control
   characters anywhere, length capped. Display names do not go into headers at
   all.
2. **No user enumeration.** `POST /api/auth/forgot` returns an identical
   response, with comparable timing, whether or not the address is known.
3. **Rate-limit hard**, per address and per IP, well below the general limiter.
   Unthrottled this is a mail bomb pointed at a third party and the fastest way
   to get the server's IP onto a blocklist.
4. **Short TTL — 30 minutes, single use.** Email is a lower-trust channel than
   an owner handing over a link: it rests in an inbox, may cross a relay you do
   not control, and is often readable by someone's IT department.
5. **Changing an email address requires the current password**, and notifies the
   *old* address. Without that, a stolen session becomes account takeover via
   "change email, then forgot password".
6. **Verify an address before it can receive resets** (open decision D5). A
   typo'd address otherwise means reset links are posted to a stranger.
7. **No CV content, ever.** The message carries who it is from, one link, an
   expiry, and "ignore this if it wasn't you".
8. Failures are best-effort and never throw into the request path, and never
   echo upstream detail — the rules `translateDocker.ts` and `translate.ts`
   already follow.

### Tests

Mock the transport. The table that matters is injection: bare CR, bare LF,
CRLF, percent-encoded and unicode line separators in the address and in every
header-bound value — all rejected, none sanitised. Plus an enumeration test
asserting identical responses for known and unknown addresses, and TTL/reuse on
the grant.

**Effort: 1–1.5 days**, nearly all of it the SMTP client and the injection
tests. Depends on Phase 3; independent of everything after it.

---

## Phase 4 — client

- `AuthGate` (159 lines) becomes a real login form; add Bootstrap, Invite-accept,
  Reset, and Recovery-codes screens.
- **"Signed in as X" + Log out** in `AppHeader`. Today the client cannot answer
  "who am I?" at all — `saved_by` appears only as metadata on past saves.
- **Admin panel** (owner only): user list, invite, issue reset link, disable,
  role change.
- **Per-resume "Share with the team"** toggle writing `visibility`.
- **Profile screen**: display name, password change, optional email address
  (with the verify step and the current-password requirement from §3b), and
  "Regenerate recovery codes".
- **"Forgot password?"** on the login screen — rendered only when the server
  reports a configured mail transport.
- **Mail settings** in the owner's admin panel, reusing the existing settings
  form machinery and its write-only secret handling.
- `api.ts` gains `me`, `invite`, `acceptInvite`, `requestReset`, `redeem`,
  `recoveryCodes`, `forgotPassword`, `setEmail`, `verifyEmail`.
- `clearAllCaches()` **must** still run on logout. On a shared machine the
  localStorage cache is a plaintext CV, and multi-user makes shared machines
  more likely, not less. Preserve the existing dirty-queue warning.

**Effort: 1–2 days.**

---

## Phase 5 — backup and sync under ownership

The semantics genuinely change, so decide rather than discover:

- `GET /api/backup/export` (whole-instance zip) → **owner only**. A member's
  export contains their own resumes.
- `POST /api/backup/import` merges by resume id. Ownership rule: **the importer
  becomes the owner**, unless the importer is an owner and the file carries an
  `owner_id` that exists in this instance.
- **Folder sync (`RESUME_BACKUP_DIR`) stays desktop-only.** It is already gated
  by `isDesktop()`, and "one file per resume in a shared cloud folder" has no
  coherent meaning once resumes have owners. Assert the gate rather than
  extending it.
- Tombstones are unchanged — they carry an id and a timestamp, no identity.

**Effort: half a day to a day.**

---

## Phase 6 — offline load, without a PWA

Two small pieces, deliberately not the multi-day PWA layer in `open-items.md`:

1. **`listCached()` in `lib/localCache.ts`.** The key scan already exists in
   `listDirty()`, which filters to `rec?.dirty` — so clean cached resumes are
   invisible to it. Without this, an offline shell lands you on an empty picker
   (`ResumeList` calls `api.listResumes()` and sets `[]` on failure), and only a
   bookmarked `/r/:id` reaches a CV. The picker shows cached entries, clearly
   labelled offline.
2. **A shell-only service worker.** Precache `index.html`, the entry JS/CSS and
   the fonts. **Never cache `/api/*`** — CV content must stay in the one
   browser-side store that `clearAllCaches()` wipes on logout, or PRIVACY.md
   stops being true. Add an update prompt on a new worker.

Exports stay online-only when offline: an honest message beats a dynamic-import
crash. Precaching `exporter` (378 kB) plus pdfmake (949 kB) plus a font module
per family is not worth it.

`syncEngine.decideBoot` already has the branch — `server unreachable + any
record → offline-local` — so the app logic needs nothing.

**Effort: half a day.**

---

## Phase 7 — docs, tests, gates

- **Tests.** The existing `createResumeDb(':memory:')` + supertest setup makes
  this tractable. Required: an auth matrix (no auth / service token / member /
  owner / disabled / expired session / bad session) and a **scoping matrix per
  route × role** — table-driven, exhaustive, because this is where a leak hides.
  Plus reset redemption (each trigger, expiry, reuse, session invalidation) and
  the bootstrap race (route 404s once a user exists).
- **Docs.** New `DEPLOYING.md` (Phase 0). Rewrites — not amendments — of
  PRIVACY.md (new classes of personal data — accounts, sessions, and optional
  email addresses; which relay a message crosses when the owner configures SMTP;
  owner visibility stated plainly) and SECURITY.md (scope, the new trust boundaries,
  recovery mode as a deliberate design). CLAUDE.md gains an auth section;
  `.claude/skills/security-review.md` gains the authorization review pass.
- **Gates.** New modules under `server/` need their line in CLAUDE.md §3 or
  `npm run check:arch` fails. `scripts/recover.mjs` likewise.

**Effort: ~1 day.**

---

## Effort summary

| Phase | Work | Effort |
|---|---|---|
| 0 | Deployment hardening (no code) | afternoon |
| 1 | Identity core | ~1 day |
| 2 | Authorization + scoping | 1–2 days |
| 3 | Account lifecycle + reset | ~1 day |
| 3b | Optional email (sendmail + SMTP) | 1–1.5 days |
| 4 | Client | 1–2 days |
| 5 | Backup/sync semantics | 0.5–1 day |
| 6 | Offline load (no PWA) | 0.5 day |
| 7 | Docs, tests, gates | ~1 day |

**Total: roughly 7–10 days.** Zero new dependencies. Required configuration is
still one bootstrap code, once; mail is optional and configured in-app by the
owner, with no `.env` entry at all.

Phase 0 and Phase 6 are independent of the rest and can ship at any time.
Phase 3b depends only on Phase 3, and can be dropped or deferred without
affecting anything after it — the other three reset triggers stand alone.

---

## Open decisions (needed before Phase 1)

- **D1. Username or email as the login identifier?** Email is familiar, but the
  app never sends mail, so it implies a capability that does not exist. A
  username plus a display name avoids the implication. Leaning username.
- **D2. Session lifetimes.** Proposed 30-day absolute, 14-day idle. A firm
  handling client CVs may want much shorter.
- **D3. Keep `RESUME_API_TOKENS` (named tokens)?** They become redundant once
  `saved_by` is a real user. Proposal: keep reading them for back-compat, treat
  them as service credentials, stop documenting them.
- **D5. Must an email address be verified before it can receive resets?**
  Proposal: yes. Unverified, a typo means reset links go to a stranger — and the
  address is attacker-controlled input in the one flow that hands out
  credentials. Cost is one more grant kind and one more screen.
- **D4. Anti-CSRF token?** `SameSite=Strict` plus the `Sec-Fetch-Site` guard is
  adequate for a same-origin SPA. A double-submit token is cheap and dependency-
  free, but it is defence in depth rather than a fix. Proposal: defer, with the
  trigger being "a cross-origin client is added".

## Risks

- **Scoping is the whole game.** A missed filter is a silent cross-user data
  leak. The required-`Viewer` parameter plus the route × role matrix is the
  mitigation; do not skip either.
- **Three reset triggers is more surface than one.** Mitigated by the single
  redemption path — if that ever forks, the risk is back.
- **PRIVACY.md becomes a different document.** It currently describes a
  single-tenant tool. Owner-sees-everything must be stated where a data subject
  would look for it, not buried.
- **Email is the largest new attack surface in this plan.** Header injection,
  enumeration and mail-bombing are all classic and all cheap to get wrong; the
  transport code is also the only new network *client* being added. It is
  optional and isolated behind one setting, which is what keeps it acceptable.
- **The desktop build is the most likely regression.** It shares `createApp()`
  with the server, so every gate added here runs there too. The existing
  `isDesktop()` seam is the place to keep them apart.
