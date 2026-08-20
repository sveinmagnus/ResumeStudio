import type { Request, Response, NextFunction } from 'express'
import { timingSafeEqual } from 'crypto'
import type { AccountsStore, Viewer } from './accounts.js'

/**
 * Authentication — turning a request into a `Viewer`, or a 401.
 *
 * THREE MODES, decided by what exists rather than by configuration:
 *
 *  - **accounts** — any user row exists. A session cookie is the way in;
 *    `RESUME_API_TOKEN` still works as a service credential (see below).
 *  - **token** — no users, but `RESUME_API_TOKEN`/`RESUME_API_TOKENS` is set.
 *    The pre-accounts behaviour, kept so an existing server keeps running
 *    across the upgrade and until its operator creates the first account.
 *  - **open** — neither. The desktop build and local dev: one person on
 *    loopback, where a login screen is friction and nothing else.
 *
 * The mode is derived, not declared, because the alternative is an env var that
 * can disagree with the database — and the failure of that disagreement is
 * either a lockout or an open server.
 *
 * WHAT A SERVICE CREDENTIAL IS. `RESUME_API_TOKEN` resolves to a viewer with
 * `userId: null` and `role: 'owner'`. It is a shared secret, so it cannot
 * identify a person and is not treated as one: it sees everything, and any
 * resume it creates is left unowned. Real people get accounts; scripts, CI and
 * curl get this.
 *
 * NAMED TOKENS ARE GONE IN ACCOUNTS MODE (plan D3). `RESUME_API_TOKENS` is read
 * in `token` mode only, so an un-migrated instance keeps running; bootstrap
 * converts each one into a real account, and from then on the env var
 * authenticates nothing. A nickname on a shared secret cannot be revoked,
 * cannot expire, and names whoever holds it rather than a person — an account
 * does that job properly.
 */

/**
 * Name of the HttpOnly session cookie. The browser client never reads or writes
 * it — it cannot, it is HttpOnly — and its value is now an opaque session id
 * rather than the API token it used to carry, so a database leak yields no
 * usable credential.
 *
 * Renamed from `rs_token` deliberately: a cookie left over from the previous
 * scheme holds a raw token, and under the new scheme it would be looked up as a
 * session id and simply not resolve. A distinct name makes that a clean 401
 * rather than an ambiguous one, and `clearLegacyCookie` sweeps the old one.
 */
export const SESSION_COOKIE = 'rs_session'

/** The pre-accounts cookie. Only ever cleared, never read. */
export const LEGACY_COOKIE = 'rs_token'

export type AuthMode = 'open' | 'token' | 'accounts'

/** Everything a service credential is allowed to be: everything, but nobody. */
function serviceViewer(name: string | null): Viewer {
  return { userId: null, role: 'owner', name }
}

/**
 * Who is using this install, when there are no accounts to ask.
 *
 * The desktop build never requires a login, but it can still know whose CVs
 * these are: Settings carries a username, display name and email, projected
 * onto env by `settings.applyToEnv`. Read from env rather than imported from
 * `settings.ts` for the reason the translate and backup layers do the same —
 * it keeps the settings module a leaf, and a change takes effect without a
 * restart.
 *
 * This authenticates nothing. It is a label on the person at the keyboard, and
 * the identity a resume carries with it if it later moves to a shared instance.
 */
export interface LocalIdentity {
  username: string
  displayName: string
  email: string
}

export function localIdentity(): LocalIdentity {
  return {
    username: (process.env.RESUME_USER_USERNAME ?? '').trim(),
    displayName: (process.env.RESUME_USER_DISPLAY_NAME ?? '').trim(),
    email: (process.env.RESUME_USER_EMAIL ?? '').trim(),
  }
}

/** The name to stamp on a save when nobody is signed in. Null when unset. */
function localViewerName(): string | null {
  const id = localIdentity()
  return id.displayName || id.username || null
}

// Read lazily (per request) rather than at import time so tests can vary the
// token with vi.stubEnv. Env doesn't change after boot, so runtime behaviour
// is unchanged.
function configuredToken(): Buffer | null {
  const tok = process.env.RESUME_API_TOKEN?.trim()
  return tok ? Buffer.from(tok, 'utf8') : null
}

interface NamedToken {
  name: string
  token: Buffer
}

/**
 * `RESUME_API_TOKENS="kari:s3cret1,ola:s3cret2"` — being removed (plan D3).
 *
 * Honoured only in `token` mode, so an instance that has not migrated yet keeps
 * working. Malformed pairs are skipped.
 */
function configuredNamedTokens(): NamedToken[] {
  const raw = process.env.RESUME_API_TOKENS?.trim()
  if (!raw) return []
  const out: NamedToken[] = []
  for (const pair of raw.split(',')) {
    const i = pair.indexOf(':')
    if (i <= 0) continue
    const name = pair.slice(0, i).trim()
    const token = pair.slice(i + 1).trim()
    if (name && token) out.push({ name, token: Buffer.from(token, 'utf8') })
  }
  return out
}

/** True when a token is configured at all. */
export function isTokenConfigured(): boolean {
  return configuredToken() !== null || configuredNamedTokens().length > 0
}

/**
 * The names on the configured legacy tokens, for the bootstrap migration to
 * turn into accounts. Secrets are deliberately not exposed: the migration
 * creates locked accounts, never accounts whose password is the old secret.
 */
export function legacyTokenNames(): string[] {
  return configuredNamedTokens().map((t) => t.name)
}

/**
 * Compare in constant time. Length is compared first (and leaks only the
 * length) because `timingSafeEqual` requires equal-length buffers.
 */
function safeCompare(a: string, b: Buffer): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  if (aBuf.length !== b.length) return false
  return timingSafeEqual(aBuf, b)
}

/**
 * Validate a presented token against the single token AND every named token.
 * Every candidate is evaluated with no early return, so response time does not
 * reveal which configured token half-matched.
 */
export function tokenIsValid(provided: string | null | undefined): boolean {
  if (!provided) return false
  const single = configuredToken()
  let ok = single ? safeCompare(provided, single) : false
  // Named tokens authenticate only until the instance has accounts. Checking
  // the mode here rather than at the call site keeps the one answer to "is this
  // token good" in one place.
  if (authMode() !== 'accounts') {
    for (const nt of configuredNamedTokens()) {
      if (safeCompare(provided, nt.token)) ok = true
    }
  }
  return ok
}

/** The label behind a presented token, for `saved_by`. Attribution, not identity. */
export function identifyToken(provided: string | null | undefined): string | null {
  if (!provided) return null
  for (const nt of configuredNamedTokens()) {
    if (safeCompare(provided, nt.token)) return nt.name
  }
  return null
}

/** Minimal cookie-header parser — avoids pulling in a cookie-parser dependency. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    if (!k) continue
    const rawVal = part.slice(eq + 1).trim()
    // A malformed percent-escape (e.g. `%zz`) makes decodeURIComponent throw a
    // URIError — which would otherwise become a 500 on every auth-gated route.
    // Fall back to the raw value so a bad cookie is treated as a bad token (401).
    try {
      out[k] = decodeURIComponent(rawVal)
    } catch {
      out[k] = rawVal
    }
  }
  return out
}

/** The session id a browser presented, if any. */
export function presentedSession(req: Request): string | null {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] || null
}

/**
 * The token presented on a request: `Authorization: Bearer` only.
 *
 * Unlike the previous scheme this does NOT fall back to the cookie — the cookie
 * now means a session, and treating its contents as a token would make a stolen
 * session id usable as a bearer credential.
 */
export function presentedToken(req: Request): string | null {
  const header = req.headers.authorization
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim()
  return null
}

/**
 * The accounts store the middleware resolves sessions against.
 *
 * Injected rather than imported so `app.ts` stays the only place that knows how
 * the database is built, and so tests can drive the middleware against an
 * in-memory store without touching the default connection.
 */
let accounts: AccountsStore | null = null

export function setAccountsStore(store: AccountsStore | null): void {
  accounts = store
}

export function authMode(): AuthMode {
  if (accounts?.hasAnyUser()) return 'accounts'
  return isTokenConfigured() ? 'token' : 'open'
}

/** Whether the client must present something. Drives the login screen. */
export function isAuthRequired(): boolean {
  return authMode() !== 'open'
}

/**
 * Resolve a request to a viewer, or null.
 *
 * Order matters: a session is checked first so that in `accounts` mode the
 * common case costs one indexed lookup, and a service token cannot shadow a
 * real user's identity on a request that carried both.
 */
export function resolveViewer(req: Request): Viewer | null {
  const mode = authMode()
  // An unauthenticated install still has an author: whoever filled in Settings.
  if (mode === 'open') return serviceViewer(localViewerName())

  if (mode === 'accounts' && accounts) {
    const sid = presentedSession(req)
    if (sid) {
      const user = accounts.resolveSession(sid)
      if (user) return { userId: user.id, role: user.role, name: user.display_name }
    }
  }

  const token = presentedToken(req)
  if (token && tokenIsValid(token)) return serviceViewer(identifyToken(token))

  // In `token` mode the cookie carries the token itself — there is no session
  // table to key on — because that is what `POST /api/auth/login` sets. Without
  // this branch a browser could log in and then be rejected on every subsequent
  // request, since the token would only be honoured as a Bearer header.
  if (mode === 'token') {
    const cookieToken = presentedSession(req)
    if (cookieToken && tokenIsValid(cookieToken)) return serviceViewer(identifyToken(cookieToken))
  }

  return null
}

/**
 * Auth middleware. Attaches `res.locals.viewer` on success.
 *
 * All failure paths return the same generic 401: distinguishing "missing" from
 * "wrong" leaks what the parser saw.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const viewer = resolveViewer(req)
  if (!viewer) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  res.locals.viewer = viewer
  // Kept for the routes that stamp attribution; a service token still supplies
  // its label, a real user supplies their display name.
  res.locals.userName = viewer.name
  next()
}

/** The viewer a route handler should act as. Throws only if the middleware was skipped. */
export function viewerOf(res: Response): Viewer {
  const v = (res.locals as { viewer?: Viewer }).viewer
  if (!v) throw new Error('authMiddleware did not run for this route')
  return v
}

/** Guard for owner-only routes. Responds 403 and returns false when refused. */
export function requireOwner(res: Response): boolean {
  if (viewerOf(res).role === 'owner') return true
  res.status(403).json({ error: 'Forbidden' })
  return false
}
