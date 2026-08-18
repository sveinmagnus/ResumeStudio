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
  since the exposure differs (see below).
- Steps to reproduce, and what an attacker would gain.

Expect an acknowledgement within about a week. This is a small project
maintained by one person, so please allow reasonable time for a fix before any
public disclosure.

## Supported versions

The most recent release is supported. Fixes ship in a new release rather than
as patches to older ones, and the desktop build updates itself.

## What is in scope

The parts of the system that process input we do not control:

- **Imported files** — CVpartner JSON, LinkedIn `.zip`, Europass XML, AI-import
  JSON, backup archives. These are untrusted input to a parser.
- **Rendering user content** — the HTML preview and the exporters. Escaping is
  security-critical here (`lib/richText.ts`, `lib/viewFilter.ts`,
  `lib/viewStyle.ts`, `lib/viewHeader.ts`).
- **The server API** — authentication (cookie and bearer), rate limiting, the
  security headers in `server/app.ts`, and the SQLite layer.
- **The auto-updater** — signature/checksum handling, the download host
  allowlist, and the staged file swap.
- **Secret handling** — API keys for the LLM and translation providers are
  write-only over the API and must never be echoed back.

## What is out of scope

- **A self-hosted server deployed without `RESUME_API_TOKEN`.** An empty token
  disables authentication deliberately, for local development. Exposing such an
  instance to a network is a deployment choice, not a vulnerability.
- **The desktop build's local HTTP server.** It binds locally for the browser
  UI. Anyone with an account on that machine already has the data directory.
- **Content you put in your own CV.** Resume Studio renders your content into
  your exports; that is its purpose.
- **Third-party AI or translation providers you configure.** What you send them
  is governed by their terms. See [PRIVACY.md](./PRIVACY.md) for what is sent
  and when.

## How the project defends itself

Not a guarantee, but so you know what has already been considered:

- CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and
  `Permissions-Policy` on every response; fonts self-hosted so no third-party
  origin is needed.
- Constant-time token comparison; a failure-focused rate limiter on the
  authenticated API.
- The updater **fails closed** without a checksum, and only downloads from an
  allowlisted host. A server build refuses to update itself at all.
- XSS regression suites around every render boundary, plus CodeQL
  (`security-extended`) and gitleaks in CI, and `npm audit` at release time.
- Snapshots are stored image-free; deletion propagates as id-and-timestamp
  tombstones carrying no personal data.
