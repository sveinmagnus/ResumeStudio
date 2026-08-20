/**
 * Auth endpoints (mounted at /api/auth, rate-limited, NOT behind authMiddleware
 * — this is how a browser authenticates in the first place).
 *
 * A password or token is exchanged for an HttpOnly cookie carrying an opaque
 * SESSION ID, so nothing JS-readable ever holds a credential and a leaked
 * database yields no usable session. Non-browser clients still use
 * `Authorization: Bearer` with a service token (see auth.ts).
 *
 *   GET  /api/auth/status    → { mode, auth_required, bootstrap_available }
 *   POST /api/auth/bootstrap → spend the one-time code, create the owner
 *   POST /api/auth/login     → password (accounts) or token (legacy), Set-Cookie
 *   POST /api/auth/logout    → end this session
 *   GET  /api/auth/me        → who am I (the client has never been able to ask)
 *
 * TIMING. Both the login and the bootstrap paths do the same amount of work
 * whether or not the subject exists: an unknown login still runs a scrypt
 * verification against a dummy hash, so response time does not answer "is there
 * an account with this name".
 */

import { Router, type Request, type Response } from 'express'
import {
  SESSION_COOKIE,
  LEGACY_COOKIE,
  authMode,
  isAuthRequired,
  tokenIsValid,
  resolveViewer,
  presentedSession,
  legacyTokenNames,
} from '../auth.js'
import { getAccounts, claimUnownedResumes } from '../db.js'
import { hashPassword, verifyPassword, passwordProblem, lockedPasswordHash } from '../passwords.js'
import { usernameProblem, normaliseLogin, type AccountsStore } from '../accounts.js'
import { newCsrfToken, csrfCookie } from '../csrf.js'
import { isMailConfigured } from '../mail.js'
import {
  bootstrapCodeMatches,
  clearBootstrapCode,
  hasBootstrapCode,
} from '../bootstrap.js'

const router = Router()

function isProd(): boolean {
  return process.env.NODE_ENV === 'production'
}

/**
 * Set-Cookie for the session. HttpOnly so page JS (and any XSS) cannot read it;
 * SameSite=Strict so it is not sent on cross-site requests (the CSRF brake);
 * Secure in production. No Max-Age: sessions end when something makes them
 * untrustworthy, not on a clock (plan D2).
 */
function setCookieValue(sessionId: string): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
  ]
  if (isProd()) parts.push('Secure')
  return parts.join('; ')
}

function clearCookieValue(name: string): string {
  const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0']
  if (isProd()) parts.push('Secure')
  return parts.join('; ')
}

/**
 * A legacy token name reduced to something the username rules accept: lower
 * case, and anything outside the allowed charset folded to a dash. A name that
 * survives as nothing usable (punctuation only) falls back to a numbered
 * placeholder rather than failing the whole migration.
 */
function slugFromTokenName(name: string, index: number): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  if (slug.length >= 2 && !/^[0-9]+$/.test(slug)) return slug
  return `legacy-user-${index + 1}`
}

/**
 * Turn every `RESUME_API_TOKENS` entry into a real account (plan D3).
 *
 * Runs INSIDE bootstrap, in the same request that creates the owner. Doing it
 * at boot instead would create users while none of them has a usable password,
 * flipping the instance into `accounts` mode — where bootstrap 404s — and
 * locking everybody out of their own server.
 *
 * Each account is created with a LOCKED password: the shared secret it came
 * from must not keep working as that person's credential. The owner issues each
 * of them a reset link, which is the same flow as any other forgotten password.
 */
function convertLegacyTokens(accounts: AccountsStore): string[] {
  const created: string[] = []
  legacyTokenNames().forEach((name, i) => {
    let username = slugFromTokenName(name, i)
    // A converted name can collide with the owner's chosen username, or with
    // another token's slug.
    let attempt = 1
    while (accounts.findByLogin(username)) {
      attempt += 1
      username = `${slugFromTokenName(name, i)}-${attempt}`.slice(0, 64)
    }
    accounts.createUser({
      username,
      displayName: name,
      pwHash: lockedPasswordHash(),
      role: 'member',
    })
    created.push(username)
  })
  return created
}

/**
 * A hash to verify against when no user matched, so a wrong username costs the
 * same as a wrong password. Generated once per process.
 */
let dummyHash: string | null = null
async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= await hashPassword(`unused-${Math.random()}`)
  await verifyPassword(password, dummyHash)
}

/** GET /api/auth/status — what the login screen needs. Leaks no secret. */
router.get('/status', (_req: Request, res: Response): void => {
  const mode = authMode()
  res.json({
    mode,
    auth_required: isAuthRequired(),
    // Only true on a server with no accounts AND a code waiting to be spent, so
    // the setup screen cannot be summoned on an instance that already has one.
    bootstrap_available: mode !== 'accounts' && hasBootstrapCode(),
    // Whether "Forgot password?" can do anything. It is asked here because the
    // login screen is by definition signed out, and the per-user answer lives
    // behind authentication. A bare boolean: it says a transport exists, never
    // which one or where it points.
    mail_configured: isMailConfigured(),
  })
})

/**
 * POST /api/auth/bootstrap — { code, username, display_name, password }.
 *
 * Creates the first account as `owner` and, in the same transaction, gives it
 * every resume that has no owner: on an upgrade those are the existing CVs, and
 * leaving them unowned would hide them from the person who just installed this.
 * Returns the recovery codes ONCE.
 */
router.post('/bootstrap', (req: Request, res: Response): void => {
  void (async () => {
    const accounts = getAccounts()
    if (accounts.hasAnyUser()) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    const body = (req.body ?? {}) as Record<string, unknown>
    if (!bootstrapCodeMatches(body.code)) {
      res.status(401).json({ error: 'That code is not valid. Check the server log for the current one.' })
      return
    }
    const nameProblem = usernameProblem(body.username)
    if (nameProblem) {
      res.status(400).json({ error: nameProblem })
      return
    }
    const pwProblem = passwordProblem(body.password)
    if (pwProblem) {
      res.status(400).json({ error: pwProblem })
      return
    }
    const displayName = typeof body.display_name === 'string' && body.display_name.trim()
      ? body.display_name.trim()
      : String(body.username)

    const pwHash = await hashPassword(body.password as string)
    const user = accounts.createUser({
      username: body.username as string,
      displayName,
      pwHash,
      role: 'owner',
    })
    const claimed = claimUnownedResumes(user.id)
    const convertedTokens = convertLegacyTokens(accounts)
    const recoveryCodes = accounts.issueRecoveryCodes(user.id)
    clearBootstrapCode()

    const sid = accounts.createSession(user.id)
    accounts.recordLogin(user.id)
    res.setHeader('Set-Cookie', [setCookieValue(sid), csrfCookie(newCsrfToken())])
    res.json({
      ok: true,
      user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role },
      claimed_resumes: claimed,
      recovery_codes: recoveryCodes,
      // Named tokens stop authenticating from here on, so the owner needs to
      // know which accounts now exist and are waiting for a reset link.
      converted_tokens: convertedTokens,
    })
  })().catch(() => {
    res.status(500).json({ error: 'Could not create the first account.' })
  })
})

/**
 * POST /api/auth/login — { login, password } in accounts mode, { token } in the
 * legacy token mode.
 */
router.post('/login', (req: Request, res: Response): void => {
  void (async () => {
    const mode = authMode()
    // Auth disabled → nothing to log into; report success so the client proceeds.
    if (mode === 'open') {
      res.json({ ok: true, auth_required: false })
      return
    }
    const body = (req.body ?? {}) as Record<string, unknown>

    if (mode === 'token') {
      if (typeof body.token !== 'string' || !tokenIsValid(body.token)) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
      // A token instance has no session table to key on; the cookie keeps
      // carrying the token, as it did before accounts existed.
      res.setHeader('Set-Cookie', [setCookieValue(body.token), csrfCookie(newCsrfToken())])
      res.json({ ok: true, auth_required: true })
      return
    }

    const accounts = getAccounts()
    const login = typeof body.login === 'string' ? body.login : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const user = login ? accounts.findByLogin(normaliseLogin(login)) : null

    if (!user) {
      // Same work as a real verification, so timing does not answer "does this
      // account exist".
      await dummyVerify(password)
      res.status(401).json({ error: 'Wrong username or password.' })
      return
    }
    if (user.disabled_at) {
      await dummyVerify(password)
      res.status(401).json({ error: 'Wrong username or password.' })
      return
    }
    if (!(await verifyPassword(password, user.pw_hash))) {
      res.status(401).json({ error: 'Wrong username or password.' })
      return
    }

    const sid = accounts.createSession(user.id)
    accounts.recordLogin(user.id)
    res.setHeader('Set-Cookie', [setCookieValue(sid), csrfCookie(newCsrfToken()), clearCookieValue(LEGACY_COOKIE)])
    res.json({
      ok: true,
      auth_required: true,
      user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role },
    })
  })().catch(() => {
    res.status(500).json({ error: 'Could not sign in.' })
  })
})

/** POST /api/auth/logout — end this session and clear the cookie. */
router.post('/logout', (req: Request, res: Response): void => {
  const sid = presentedSession(req)
  if (sid && authMode() === 'accounts') {
    try {
      getAccounts().deleteSession(sid)
    } catch {
      // A logout that cannot reach the database still clears the cookie; the
      // alternative is a user who cannot sign out because storage is unhappy.
    }
  }
  res.setHeader('Set-Cookie', [clearCookieValue(SESSION_COOKIE), clearCookieValue(LEGACY_COOKIE)])
  res.json({ ok: true })
})

/**
 * GET /api/auth/me — the identity the client has never been able to ask for.
 * 401 rather than an empty body when nobody is signed in, so the client's
 * existing UnauthorizedError path handles it.
 */
router.get('/me', (req: Request, res: Response): void => {
  const viewer = resolveViewer(req)
  if (!viewer) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  res.json({
    user_id: viewer.userId,
    name: viewer.name,
    role: viewer.role,
    // A service credential is not a person; the client uses this to decide
    // whether to offer a profile at all.
    service: viewer.userId === null,
    mode: authMode(),
  })
})

export default router
