/**
 * Account lifecycle — invites, profiles, and every way back in after a
 * forgotten password.
 *
 * FOUR TRIGGERS, ONE MECHANISM. A reset can start from an owner's link, a
 * recovery code, server recovery mode, or a reset email. They differ only in
 * who mints the grant and how it reaches the human; all four end at
 * `POST /reset`, which redeems an ordinary `reset` grant. Three ways to reset a
 * password must not become three classes of bug, so there is exactly one place
 * that sets a password from a token.
 *
 * ENUMERATION. `/forgot` answers identically whether or not the account exists,
 * whether or not it has an email, and whether or not that email is verified.
 * Anything else turns the reset form into a "does this person have an account
 * here" oracle, which for a CV tool is itself the sensitive answer.
 *
 * Routes under `/me` require a real user: a service credential is not a person
 * and has no profile, no password and no recovery codes.
 */

import { Router, type Request, type Response } from 'express'
import { authMiddleware, viewerOf, requireOwner, SESSION_COOKIE } from '../auth.js'
import { getAccounts } from '../db.js'
import { hashPassword, verifyPassword, passwordProblem } from '../passwords.js'
import { usernameProblem, normaliseLogin, type Role } from '../accounts.js'
import {
  isMailConfigured, sendResetMail, sendVerifyMail, isValidEmailAddress,
} from '../mail.js'
import { newCsrfToken, csrfCookie } from '../csrf.js'
import { sessionCookie } from '../cookies.js'

const router = Router()

/** See server/cookies.ts for why `Secure` follows the connection, not NODE_ENV. */
const newSessionCookie = (req: Request, sessionId: string): string =>
  sessionCookie(req, SESSION_COOKIE, sessionId)

/** The base the emailed links are built on. Empty means links cannot be sent. */
function appBaseUrl(): string {
  return (process.env.RESUME_APP_BASE_URL ?? '').trim().replace(/\/+$/, '')
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * A real signed-in person, or null.
 *
 * A service credential has `userId: null` — it authenticates but is nobody, so
 * every self-service route below refuses it rather than guessing whose profile
 * it meant.
 */
function currentUserId(res: Response): string | null {
  return viewerOf(res).userId
}

function requirePerson(res: Response): string | null {
  const id = currentUserId(res)
  if (id) return id
  res.status(403).json({ error: 'This needs a signed-in user account, not a service token.' })
  return null
}

// ─── Public: the ways back in ────────────────────────────────────────────────

/**
 * POST /forgot — { login }. Emails a reset link when everything lines up.
 *
 * Deliberately indistinguishable in every failure case. The work is fired and
 * the same body returned regardless, so neither the status nor the shape of the
 * response reveals whether an account, an address, or a verification exists.
 */
router.post('/forgot', (req: Request, res: Response): void => {
  const login = str((req.body as Record<string, unknown> | undefined)?.login)
  const generic = { ok: true, sent: null }

  void (async () => {
    if (!login || !isMailConfigured() || !appBaseUrl()) return
    const accounts = getAccounts()
    const user = accounts.findByLogin(normaliseLogin(login))
    // Every one of these is a reason to send nothing, and none of them may be
    // visible to the caller.
    if (!user || user.disabled_at || !user.email || !user.email_verified_at) return
    const token = accounts.mintGrant('reset', { userId: user.id })
    await sendResetMail(user.email, `${appBaseUrl()}/reset?token=${encodeURIComponent(token)}`)
  })().catch(() => {
    // A mail failure is the operator's problem, never the caller's signal.
  })

  res.json(generic)
})

/**
 * POST /reset — { token, password }. The single redemption path.
 *
 * Setting the password ends every session for that user (see
 * `accounts.setPassword`), which is the point: a reset exists because the old
 * credential may be in someone else's hands.
 */
router.post('/reset', (req: Request, res: Response): void => {
  void (async () => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const token = str(body.token)
    const problem = passwordProblem(body.password)
    if (problem) {
      res.status(400).json({ error: problem })
      return
    }
    const accounts = getAccounts()
    const grant = accounts.redeemGrant(token)
    if (!grant || grant.kind !== 'reset' || !grant.user_id) {
      res.status(400).json({ error: 'That link has expired or has already been used.' })
      return
    }
    // `/recover` already refuses a disabled account; a link minted before the
    // account was disabled must not silently rotate its credential either.
    if (accounts.getUser(grant.user_id)?.disabled_at) {
      res.status(400).json({ error: 'That link has expired or has already been used.' })
      return
    }
    accounts.setPassword(grant.user_id, await hashPassword(body.password as string))
    // Setting a password clears the recovery set, so say so rather than letting
    // the count silently drop to zero.
    res.json({ ok: true, recovery_codes_cleared: true })
  })().catch(() => {
    res.status(500).json({ error: 'Could not reset the password.' })
  })
})

/**
 * POST /recover — { login, code, password }. Spend a recovery code.
 *
 * The code is checked against the named account rather than searched for, so a
 * code cannot be tried against every user in turn.
 */
router.post('/recover', (req: Request, res: Response): void => {
  void (async () => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const login = str(body.login)
    const code = str(body.code)
    const problem = passwordProblem(body.password)
    if (problem) {
      res.status(400).json({ error: problem })
      return
    }
    const accounts = getAccounts()
    const user = login ? accounts.findByLogin(normaliseLogin(login)) : null
    if (!user || user.disabled_at || !accounts.redeemRecoveryCode(user.id, code)) {
      res.status(400).json({ error: 'That recovery code is not valid.' })
      return
    }
    accounts.setPassword(user.id, await hashPassword(body.password as string))
    /*
     * Setting a password clears every recovery code, which is the point — a
     * harvested one must not survive the change. But that would leave somebody
     * who just spent their last resort with none at all, one forgotten password
     * from needing the owner or the server console. So a fresh set is issued
     * here and returned once.
     *
     * Safe at the same trust level as the flow itself: whoever is here proved
     * they hold a code and has just set the password.
     */
    res.json({ ok: true, recovery_codes: accounts.issueRecoveryCodes(user.id) })
  })().catch(() => {
    res.status(500).json({ error: 'Could not use that recovery code.' })
  })
})

/**
 * POST /accept — { token, username, display_name, password }. Redeem an invite.
 *
 * The role comes from the GRANT, never from the request: an invitee who could
 * name their own role would simply ask to be an owner.
 */
router.post('/accept', (req: Request, res: Response): void => {
  void (async () => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const accounts = getAccounts()
    const grant = accounts.peekGrant(str(body.token))
    if (!grant || grant.kind !== 'invite') {
      res.status(400).json({ error: 'That invitation has expired or has already been used.' })
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
    // Username-only, deliberately: `findByLogin` searches the email column too,
    // so a row whose email is a bare word — planted before addresses were
    // validated, or set by an owner — would deny that word to a real colleague
    // who has every right to it. A username collides with usernames.
    if (accounts.usernameInUse(str(body.username))) {
      res.status(409).json({ error: 'That username is taken.' })
      return
    }
    // Consumed only once everything else has passed, so a rejected attempt does
    // not burn the invitation.
    if (!accounts.redeemGrant(str(body.token))) {
      res.status(400).json({ error: 'That invitation has expired or has already been used.' })
      return
    }
    const user = accounts.createUser({
      username: str(body.username),
      displayName: str(body.display_name) || str(body.username),
      pwHash: await hashPassword(body.password as string),
      role: (grant.role ?? 'member') as Role,
      email: grant.email,
    })
    const codes = accounts.issueRecoveryCodes(user.id)
    const sid = accounts.createSession(user.id)
    accounts.recordLogin(user.id)
    res.setHeader('Set-Cookie', [newSessionCookie(req, sid), csrfCookie(req, newCsrfToken())])
    res.json({
      ok: true,
      user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role },
      recovery_codes: codes,
    })
  })().catch(() => {
    res.status(500).json({ error: 'Could not create that account.' })
  })
})

/** GET /invite/:token — what an invitation is for, without spending it. */
router.get('/invite/:token', (req: Request<{ token: string }>, res: Response): void => {
  const grant = getAccounts().peekGrant(req.params.token)
  if (!grant || grant.kind !== 'invite') {
    res.status(404).json({ error: 'That invitation has expired or has already been used.' })
    return
  }
  res.json({ ok: true, role: grant.role ?? 'member', email: grant.email })
})

/** POST /verify-email — { token }. Confirms an address can receive resets (D5). */
router.post('/verify-email', (req: Request, res: Response): void => {
  const accounts = getAccounts()
  const token = str((req.body as Record<string, unknown> | undefined)?.token)
  const grant = accounts.peekGrant(token)
  if (!grant || grant.kind !== 'verify_email' || !grant.user_id || !grant.email) {
    res.status(400).json({ error: 'That link has expired or has already been used.' })
    return
  }
  // Verifies against the address the link was minted for, so a link issued for
  // an old address cannot confirm whatever the user has since typed in.
  if (!accounts.markEmailVerified(grant.user_id, grant.email)) {
    res.status(400).json({ error: 'That address is no longer the one on the account.' })
    return
  }
  accounts.redeemGrant(token)
  res.json({ ok: true })
})

// ─── Signed in: your own account ─────────────────────────────────────────────

router.use(authMiddleware)

/** GET /me — the profile behind the current session. */
router.get('/me', (_req: Request, res: Response): void => {
  const id = requirePerson(res)
  if (!id) return
  const accounts = getAccounts()
  const user = accounts.getUser(id)
  if (!user) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  res.json({
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    email: user.email,
    email_verified: user.email_verified_at !== null,
    role: user.role,
    recovery_codes_left: accounts.countRecoveryCodes(user.id),
    mail_configured: isMailConfigured(),
  })
})

/**
 * PUT /me — { display_name?, username?, email?, current_password? }.
 *
 * Display name is cosmetic and changes freely. The two LOGIN identifiers do
 * not: changing the username locks the old one out, and changing the email
 * repoints the password-reset channel, so both cost the current password.
 * Without that, a stolen session is enough to take an account over or to lock
 * its owner out of it.
 */
router.put('/me', (req: Request, res: Response): void => {
  void (async () => {
    const id = requirePerson(res)
    if (!id) return
    const accounts = getAccounts()
    const body = (req.body ?? {}) as Record<string, unknown>
    const changesLogin = 'email' in body || typeof body.username === 'string'

    if (changesLogin) {
      const hash = accounts.getHash(id)
      const current = str(body.current_password)
      if (!hash || !current || !(await verifyPassword(current, hash))) {
        res.status(403).json({
          error: 'Enter your current password to change your username or email address.',
        })
        return
      }
    }

    if (typeof body.display_name === 'string') {
      const name = body.display_name.trim()
      if (!name) {
        res.status(400).json({ error: 'Display name cannot be empty.' })
        return
      }
      accounts.setDisplayName(id, name)
    }

    if (typeof body.username === 'string') {
      const problem = usernameProblem(body.username)
      if (problem) {
        res.status(400).json({ error: problem })
        return
      }
      if (!accounts.setUsername(id, body.username)) {
        res.status(409).json({ error: 'That username is taken.' })
        return
      }
    }

    if ('email' in body) {
      const email = str(body.email).toLowerCase()
      if (email && !isValidEmailAddress(email)) {
        res.status(400).json({ error: 'That is not a valid email address.' })
        return
      }
      if (email && accounts.emailInUse(email, id)) {
        res.status(409).json({ error: 'That address is already used by another account.' })
        return
      }
      accounts.setEmail(id, email || null)
      if (email && isMailConfigured() && appBaseUrl()) {
        const token = accounts.mintGrant('verify_email', { userId: id, email })
        await sendVerifyMail(email, `${appBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`)
      }
    }

    res.json({ ok: true })
  })().catch(() => {
    res.status(500).json({ error: 'Could not update your profile.' })
  })
})

/** POST /me/password — { current_password, password }. */
router.post('/me/password', (req: Request, res: Response): void => {
  void (async () => {
    const id = requirePerson(res)
    if (!id) return
    const body = (req.body ?? {}) as Record<string, unknown>
    const problem = passwordProblem(body.password)
    if (problem) {
      res.status(400).json({ error: problem })
      return
    }
    const accounts = getAccounts()
    const hash = accounts.getHash(id)
    if (!hash || !(await verifyPassword(str(body.current_password), hash))) {
      res.status(403).json({ error: 'That is not your current password.' })
      return
    }
    accounts.setPassword(id, await hashPassword(body.password as string))
    // setPassword ends every session including this one, so the client must
    // sign in again — which is the correct outcome after a credential change.
    res.json({ ok: true, signed_out: true })
  })().catch(() => {
    res.status(500).json({ error: 'Could not change your password.' })
  })
})

/**
 * POST /me/recovery-codes — { current_password }. Regenerate the set.
 *
 * Costs the current password like every other credential change here, and for a
 * stronger reason than most: a recovery code outlives the session that minted
 * it and on its own sets a new password. Mintable from a session alone, a
 * borrowed screen bought ten of them, silently invalidating the set the real
 * user had saved — with nothing emailed and nothing logged.
 */
router.post('/me/recovery-codes', (req: Request, res: Response): void => {
  void (async () => {
    const id = requirePerson(res)
    if (!id) return
    const accounts = getAccounts()
    const hash = accounts.getHash(id)
    const current = str((req.body as Record<string, unknown> | undefined)?.current_password)
    if (!hash || !current || !(await verifyPassword(current, hash))) {
      res.status(403).json({ error: 'Enter your current password to replace your recovery codes.' })
      return
    }
    res.json({ ok: true, recovery_codes: accounts.issueRecoveryCodes(id) })
  })().catch(() => {
    res.status(500).json({ error: 'Could not replace your recovery codes.' })
  })
})

/** POST /me/verify-email — send (or resend) the verification link. */
router.post('/me/verify-email', (_req: Request, res: Response): void => {
  void (async () => {
    const id = requirePerson(res)
    if (!id) return
    const accounts = getAccounts()
    const user = accounts.getUser(id)
    if (!user?.email) {
      res.status(400).json({ error: 'Add an email address first.' })
      return
    }
    if (!isMailConfigured() || !appBaseUrl()) {
      res.status(400).json({ error: 'This server cannot send email.' })
      return
    }
    const token = accounts.mintGrant('verify_email', { userId: id, email: user.email })
    await sendVerifyMail(user.email, `${appBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`)
    res.json({ ok: true })
  })().catch(() => {
    res.status(500).json({ error: 'Could not send that message.' })
  })
})

// ─── Owner only: everyone else's accounts ────────────────────────────────────

/** GET / — the user list. */
router.get('/', (_req: Request, res: Response): void => {
  if (!requireOwner(res)) return
  res.json({ users: getAccounts().listUsers() })
})

/** POST /invite — { role?, email? }. Returns the link for the owner to pass on. */
router.post('/invite', (req: Request, res: Response): void => {
  if (!requireOwner(res)) return
  const body = (req.body ?? {}) as Record<string, unknown>
  const role: Role = body.role === 'owner' ? 'owner' : 'member'
  const email = str(body.email).toLowerCase() || undefined
  if (email && !isValidEmailAddress(email)) {
    res.status(400).json({ error: 'That is not a valid email address.' })
    return
  }
  const token = getAccounts().mintGrant('invite', { role, email })
  const base = appBaseUrl()
  res.json({
    ok: true,
    token,
    // Absolute when the server knows its own address, relative otherwise — an
    // owner copying a link is better served by a path than by a wrong host.
    url: base ? `${base}/accept?token=${encodeURIComponent(token)}` : `/accept?token=${encodeURIComponent(token)}`,
  })
})

/**
 * PUT /:id — the owner edits somebody else's profile.
 *
 * No password is asked for, and that is not a gap: an owner can already mint a
 * reset link for any account, so requiring the target's password would protect
 * nothing while making a routine correction impossible. Setting an address here
 * leaves it UNVERIFIED — an owner may type a colleague's address, but only the
 * colleague clicking the link proves it reaches them (D5).
 */
router.put('/:id', (req: Request<{ id: string }>, res: Response): void => {
  if (!requireOwner(res)) return
  const accounts = getAccounts()
  const target = accounts.getUser(req.params.id)
  if (!target) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>

  if (typeof body.display_name === 'string') {
    const name = body.display_name.trim()
    if (!name) {
      res.status(400).json({ error: 'Display name cannot be empty.' })
      return
    }
    accounts.setDisplayName(target.id, name)
  }

  if (typeof body.username === 'string') {
    const problem = usernameProblem(body.username)
    if (problem) {
      res.status(400).json({ error: problem })
      return
    }
    if (!accounts.setUsername(target.id, body.username)) {
      res.status(409).json({ error: 'That username is taken.' })
      return
    }
  }

  if ('email' in body) {
    const email = str(body.email).toLowerCase()
    if (email && !isValidEmailAddress(email)) {
      res.status(400).json({ error: 'That is not a valid email address.' })
      return
    }
    if (email && accounts.emailInUse(email, target.id)) {
      res.status(409).json({ error: 'That address is already used by another account.' })
      return
    }
    accounts.setEmail(target.id, email || null)
  }

  res.json({ ok: true, user: accounts.getUser(target.id) })
})

/** POST /:id/reset-link — mint a reset the owner hands over out of band. */
router.post('/:id/reset-link', (req: Request<{ id: string }>, res: Response): void => {
  if (!requireOwner(res)) return
  const accounts = getAccounts()
  if (!accounts.getUser(req.params.id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const token = accounts.mintGrant('reset', { userId: req.params.id })
  const base = appBaseUrl()
  res.json({
    ok: true,
    url: base ? `${base}/reset?token=${encodeURIComponent(token)}` : `/reset?token=${encodeURIComponent(token)}`,
  })
})

/** POST /:id/disabled — { disabled }. Ends their sessions when switching on. */
router.post('/:id/disabled', (req: Request<{ id: string }>, res: Response): void => {
  if (!requireOwner(res)) return
  const accounts = getAccounts()
  const target = accounts.getUser(req.params.id)
  if (!target) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const disabled = (req.body as Record<string, unknown> | undefined)?.disabled !== false
  // Refusing to disable the last owner is what stops an instance locking
  // everybody out of its own administration.
  if (disabled && target.role === 'owner' && accounts.countOwners() <= 1) {
    res.status(409).json({ error: 'This is the only owner. Promote somebody else first.' })
    return
  }
  if (disabled && target.id === viewerOf(res).userId) {
    res.status(409).json({ error: 'You cannot disable your own account.' })
    return
  }
  accounts.setDisabled(target.id, disabled)
  res.json({ ok: true })
})

/** POST /:id/role — { role }. */
router.post('/:id/role', (req: Request<{ id: string }>, res: Response): void => {
  if (!requireOwner(res)) return
  const accounts = getAccounts()
  const target = accounts.getUser(req.params.id)
  if (!target) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const role: Role = (req.body as Record<string, unknown> | undefined)?.role === 'owner' ? 'owner' : 'member'
  if (role === 'member' && target.role === 'owner' && accounts.countOwners() <= 1) {
    res.status(409).json({ error: 'This is the only owner. Promote somebody else first.' })
    return
  }
  accounts.setRole(target.id, role)
  res.json({ ok: true })
})

export default router
