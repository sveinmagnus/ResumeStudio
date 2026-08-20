# Security policy

## Reporting a vulnerability

Please report security issues **privately**, through GitHub's private
vulnerability reporting: open the repository's **Security** tab and choose
**Report a vulnerability**. That creates a private advisory visible only to the
maintainer.

Please do **not** open a public issue, and do not include anyone's real résumé
data in a report — a redacted or synthetic example is always enough to
reproduce.

Useful things to include:

- The version string the app reports (Settings → Version, or the picker
  footer). A released build shows the version with a leading `v` (`v1.2.3`); a
  development build shows `Dev-<commit>`, which tells us exactly what code you
  were running.
- Whether you were running the **desktop build** or a **self-hosted server**,
  and on a server whether it has user accounts. The exposure differs sharply
  (see below).
- Steps to reproduce, and what an attacker would gain.

Expect an acknowledgement within about a week. This is a small project
maintained by one person, so please allow reasonable time for a fix before any
public disclosure.

## Supported versions

The most recent release is supported. Fixes ship in a new release rather than
as patches to older ones, and the desktop build updates itself.

## What is in scope

The parts of the system that process input we do not control, and the parts that
decide who gets to see what:

- **Imported files** — CVpartner JSON, LinkedIn `.zip`, Europass XML, AI-import
  JSON, backup archives. These are untrusted input to a parser.
- **Rendering user content** — the HTML preview and the exporters. Escaping is
  security-critical here (`lib/richText.ts`, `lib/viewFilter.ts`,
  `lib/viewStyle.ts`, `lib/viewHeader.ts`).
- **Authentication and sessions** — `server/auth.ts`, `server/accounts.ts`,
  `server/passwords.ts` and `server/routes/auth.ts`: anything that gets a
  request treated as a signed-in user without a valid credential, or that makes
  a revoked session keep working.
- **Authorization and scoping** — `server/access.ts` and the `Viewer` every
  database method takes. On an instance with accounts, a member reading,
  writing, exporting or merely *learning the existence of* a résumé that is not
  theirs is the highest-severity class of bug in this project. That includes
  indirect disclosure: snapshots, storage statistics, backup exports and the
  aggregate views.
- **Account recovery** — invitations, owner-issued reset links, recovery codes
  and reset emails all end at one redemption path. A grant that survives its
  expiry, survives being used, redeems for the wrong account, or leaves old
  sessions alive afterwards is in scope.
- **The CSRF brake** — the double-submit token in `server/csrf.ts` and the
  `Sec-Fetch-Site` guard in `server/app.ts`, including anything that widens the
  exempt list.
- **The mail transport** — `server/mail.ts`. Header injection through any value
  that reaches a header or an SMTP verb, and anything that makes the server a
  usable relay or mail bomb.
- **The server API generally** — rate limiting, the security headers in
  `server/app.ts`, and the SQLite layer.
- **The auto-updater** — signature/checksum handling, the download host
  allowlist, and the staged file swap.
- **Secret handling** — API keys and SMTP credentials are write-only over the
  API and must never be echoed back; password hashes and session ids must not
  appear in responses or logs.

## What is out of scope

- **An instance deliberately running with authentication disabled.** The server
  derives its mode from what exists rather than from a flag, and there are
  three:

  | Mode | When | Who gets in |
  |---|---|---|
  | `accounts` | any user account exists | a session cookie, or `RESUME_API_TOKEN` as a service credential with owner-equivalent reach. `RESUME_API_TOKENS` stops authenticating entirely. |
  | `token` | no accounts, but `RESUME_API_TOKEN`/`RESUME_API_TOKENS` is set | the pre-accounts behaviour: any valid token has full access to every CV |
  | `open` | neither | every request passes, as an owner-equivalent viewer |

  `open` is what makes local development and the loopback desktop build usable
  without ceremony, and exposing such an instance to a network is a deployment
  choice rather than a vulnerability. Note the shape of a fresh server: with no
  token and no accounts it starts in `open` mode and prints a one-time setup
  code, and it stays open until somebody spends that code. Reaching it in that
  window is the same deployment choice.

  What *is* in scope is any way to bypass a mode that is active — reaching data
  without a session on an instance that has accounts, or without a token on one
  that requires one.
- **Recovery mode** (`npm run recover`). It lists the accounts on an instance and
  mints a one-time reset link for one of them, with no credential asked for.
  That is deliberate and it grants nothing new: running it requires the ability
  to execute a command on the machine holding `resume.db`, and anyone who can do
  that can already read every CV in that file with `sqlite3`. The trust boundary
  is unchanged; what it adds is that recovering an owner who has forgotten their
  password is a supported action instead of a hand-edit of the users table. The
  link it prints is an ordinary reset grant — 30 minutes, single use, and
  redeeming it ends every existing session for that account.
- **The desktop build's local HTTP server.** It binds locally for the browser
  UI and has no accounts by design. Anyone with an account on that machine
  already has the data directory.
- **The `owner` role seeing every résumé.** It is the documented model, not a
  scoping failure — see [PRIVACY.md](./PRIVACY.md) §2.
- **Content you put in your own CV.** Resume Studio renders your content into
  your exports; that is its purpose.
- **Third-party AI, translation or mail providers you configure.** What you send
  them is governed by their terms. See [PRIVACY.md](./PRIVACY.md) for what is
  sent and when.

## How the project defends itself

Not a guarantee, but so you know what has already been considered.

**Content and transport**

- CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and
  `Permissions-Policy` on every response; fonts self-hosted so no third-party
  origin is needed.
- XSS regression suites around every render boundary, plus CodeQL
  (`security-extended`) and gitleaks in CI, and `npm audit` at release time.
- A failure-focused rate limiter on the API: only responses of 400 and above
  spend the budget, so brute force accumulates and ordinary auto-save never
  does.

**Credentials**

- Passwords are hashed with `scrypt` from `node:crypto` — no native addon, no
  dependency. Each hash is **self-describing** (`scrypt$N=…,r=…,p=…$salt$key`),
  so verification uses the parameters that hash was made with, and the cost can
  be raised later without invalidating anybody's existing password. Comparison
  is constant-time; a malformed or unparseable stored value is a failed
  verification rather than a 500; and stored parameters whose memory cost would
  exceed the ceiling are refused, so a crafted hash cannot turn every sign-in
  attempt into an error.
- The session cookie carries an **opaque 32-byte random id**; the database
  stores only its SHA-256, so a leaked database yields no usable session. The
  cookie is `HttpOnly` (page JavaScript, and therefore any XSS, cannot read it),
  `SameSite=Strict`, and `Secure` in production.
- Sessions are **revoked, not expired**: a password change or reset deletes
  every session for that account, and a disabled account resolves to nothing on
  the very next request rather than whenever its rows are cleaned up.
- Login is **timing-equalised** — an unknown username still pays a full scrypt
  verification against a dummy hash, so response time does not answer "does this
  account exist". Every failure returns the same message.
- Service tokens are compared in constant time against every configured
  candidate with no early return, so timing does not reveal which one
  half-matched. All auth failures return the same bare 401; distinguishing
  "missing" from "wrong" would leak what the parser saw.

**Authorization**

- Every database method takes a required `Viewer`, so a query that has not
  thought about scoping does not compile. The rules themselves live in exactly
  one module (`server/access.ts`); routes ask rather than remember.
- A résumé a viewer may not see is reported **exactly as one that does not
  exist**. A distinct 403 would turn the API into an oracle for which ids are
  real, and in a firm the résumés are the people — "there is a CV here you may
  not read" is itself the disclosure.
- The route × role matrix is table-driven and exhaustive, with two negative
  controls that a status-code assertion alone would miss: a hidden résumé and a
  nonexistent one must return the identical status, and a refused write must
  leave the stored row, its version and its snapshot history untouched.

**Cross-site requests**

- A **double-submit CSRF token**: the server sets a readable `rs_csrf` cookie
  and the client echoes it in a header. Unlike `SameSite` and `Sec-Fetch-Site`,
  which are signals the browser volunteers, an attacker's page simply cannot
  read a cookie from another origin. Enforced on state-changing methods that
  carry the session cookie; the exempt list is exact paths, not prefixes, and
  holds only the endpoints that establish a credential and so cannot require one.

**Account recovery and email**

- Four ways to reset a password — an owner's link, a recovery code, recovery
  mode, a reset email — differ only in who mints the grant and how it reaches
  the person. All four redeem through one path, so they cannot become four
  classes of bug. Grants are stored hashed, expire, and are marked used inside
  the same statement that consumes them, so two simultaneous redemptions cannot
  both succeed.
- `POST /api/users/forgot` answers **identically** whether or not the account
  exists, whether or not it has an address, and whether or not that address is
  confirmed. For a CV tool, "does this person have an account here" is itself
  the sensitive answer.
- Email addresses are **rejected, never sanitised**. A CR or LF in an address
  ends the `To:` line early and turns whatever follows into further headers — a
  `Bcc:` elsewhere — or, past a blank line, a second body; the same bytes inject
  verbs into `RCPT TO:<…>`. So every header-bound value is checked for C0
  controls, DEL, the C1 block (U+0085 is a line break to several parsers) and
  the Unicode line separators, and a value that fails is refused rather than
  stripped. Non-ASCII header values are RFC 2047 encoded, split by code point;
  no display name is composed into a header at all.
- Changing the username or email address on an account costs the current
  password, which is what stops a stolen session becoming account takeover via
  "change the address, then forget the password". An address must be confirmed
  before it can receive a reset.

**Storage**

- The updater **fails closed** without a checksum, and only downloads from an
  allowlisted host. A server build refuses to update itself at all.
- Snapshots are stored image-free; deletion propagates as id-and-timestamp
  tombstones carrying no personal data.
- The database file is `chmod`'ed `0600` and its directory `0700` where the
  operating system supports it.
