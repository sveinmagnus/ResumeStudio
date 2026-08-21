/**
 * Accounts — users, sessions, grants and recovery codes on the resume DB's
 * connection. The identity half of the multi-user work; authorization lives in
 * `db.ts`, which takes the `Viewer` this module resolves.
 *
 * Four tables, one job each:
 *
 *  - **users** — who exists. `username` is required and is the identity;
 *    `email` is optional and exists only so a password reset can be self-served
 *    (see `server/mail.ts`). Both are stored lower-cased and are unique, so a
 *    login can present either without the caller saying which it is.
 *  - **sessions** — what a cookie means. The cookie carries an opaque random
 *    id; this table stores its SHA-256, so a database leak yields no usable
 *    session. Sessions do NOT expire on a timer: they end when something makes
 *    them untrustworthy (logout, a password change, an account disabled).
 *    `expires_at` is kept nullable — `null` is "never" — so a future policy is
 *    a config change rather than a migration.
 *  - **grants** — one table behind every invite and every password reset. Four
 *    things can mint one (an owner's link, a recovery code, recovery mode, a
 *    reset email) and they differ only in who calls `mintGrant` and how the
 *    token reaches the human. Redemption is a single path, so four triggers
 *    cannot become four classes of bug.
 *  - **recovery_codes** — printed once at account creation, stored hashed,
 *    single use. The only reset path that needs neither another person nor
 *    access to the server.
 *
 * Every token this module hands out is high-entropy random, so SHA-256 is the
 * right store for it. Passwords are the opposite problem and go through
 * `passwords.ts` (scrypt) — do not confuse the two.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { SqliteDatabase } from './sqlite.js'

export type Role = 'owner' | 'member'

/**
 * Who is asking. Every authorization decision in `db.ts` takes one of these.
 *
 * `userId` is null for the two viewers that are not a person: the
 * `RESUME_API_TOKEN` service credential, and the desktop build, which has no
 * accounts at all. Both carry `role: 'owner'`, so scoping passes them through
 * unchanged — which is exactly how the desktop build keeps behaving as it does
 * today while the same code enforces ownership on a server.
 */
export interface Viewer {
  userId: string | null
  role: Role
  /** Display name for `saved_by`. */
  name: string | null
}

export interface UserRow {
  id: string
  username: string
  display_name: string
  email: string | null
  email_verified_at: string | null
  role: Role
  created_at: string
  last_login_at: string | null
  disabled_at: string | null
}

interface UserWithHash extends UserRow {
  pw_hash: string
}

export type GrantKind = 'invite' | 'reset' | 'verify_email'

export interface GrantRow {
  kind: GrantKind
  user_id: string | null
  role: Role | null
  email: string | null
  created_at: string
  expires_at: string
}

export interface CreateUserInput {
  username: string
  displayName: string
  pwHash: string
  role: Role
  email?: string | null
}

/** Default lifetimes. Grants are short-lived by nature; sessions are not (D2). */
export const GRANT_TTL_MS = {
  invite: 7 * 24 * 60 * 60 * 1000,
  reset: 30 * 60 * 1000,
  verify_email: 24 * 60 * 60 * 1000,
} as const

const RECOVERY_CODE_COUNT = 10

/** How stale `last_seen_at` must be before a request refreshes it. */
const TOUCH_AFTER_MS = 5 * 60 * 1000

/**
 * Crockford-ish base32 without the characters people transcribe wrongly (I, L,
 * O, U). Recovery codes get read off a screen and typed back in, sometimes
 * months later.
 */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** SHA-256, hex. For values that are already random — never for passwords. */
function tokenHash(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/** 32 random bytes, URL-safe. The value a cookie or a link carries. */
function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/** `XXXXX-XXXXX-XXXXX-XXXXX` from the reduced alphabet. */
function newRecoveryCode(): string {
  const bytes = randomBytes(20)
  let out = ''
  for (let i = 0; i < 20; i++) {
    if (i > 0 && i % 5 === 0) out += '-'
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return out
}

/**
 * Compare two hex digests without a length-dependent early exit.
 * `timingSafeEqual` throws on unequal lengths, so that case is answered first.
 */
function hashEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Normalise a login identifier. Lower-casing both stored and presented values
 * is what lets `username` and `email` share one lookup — SQLite's `=` is
 * case-sensitive, and a user who typed `Kari` at signup should still get in
 * having typed `kari`.
 */
export function normaliseLogin(value: string): string {
  return value.trim().toLowerCase()
}

/** The charset a username may use. Deliberately narrower than an email's. */
const USERNAME_RE = /^[a-z0-9._-]{2,64}$/

/** The problem with `username`, or null. */
export function usernameProblem(username: unknown): string | null {
  if (typeof username !== 'string') return 'Username must be text.'
  const v = normaliseLogin(username)
  if (!USERNAME_RE.test(v)) {
    return 'Username must be 2-64 characters, using letters, digits, dot, dash or underscore.'
  }
  // An all-digit username could collide with an id somewhere downstream, and
  // reads as a mistake far more often than it reads as a choice.
  if (/^[0-9]+$/.test(v)) return 'Username cannot be only digits.'
  return null
}

export interface AccountsStore {
  hasAnyUser(): boolean
  countOwners(): number
  createUser(input: CreateUserInput): UserRow
  /** Create the first account, or null if one already exists. Atomic. */
  createFirstOwner(input: Omit<CreateUserInput, 'role'>): UserRow | null
  listUsers(): UserRow[]
  getUser(id: string): UserRow | null
  /** By username OR email — the caller does not say which (D1). */
  findByLogin(login: string): UserWithHash | null
  getHash(id: string): string | null
  setPassword(userId: string, pwHash: string): void
  /** Replace the hash WITHOUT ending sessions — for a silent cost upgrade. */
  rehashPassword(userId: string, pwHash: string): void
  setRole(userId: string, role: Role): void
  setDisabled(userId: string, disabled: boolean): void
  setDisplayName(userId: string, displayName: string): void
  setUsername(userId: string, username: string): boolean
  usernameInUse(username: string, exceptUserId?: string): boolean
  setEmail(userId: string, email: string | null): void
  markEmailVerified(userId: string, email: string): boolean
  recordLogin(userId: string): void
  emailInUse(email: string, exceptUserId?: string): boolean

  createSession(userId: string): string
  resolveSession(raw: string): UserRow | null
  touchSession(raw: string): void
  deleteSession(raw: string): void
  deleteUserSessions(userId: string): number

  mintGrant(kind: GrantKind, opts?: { userId?: string; role?: Role; email?: string }): string
  peekGrant(raw: string): GrantRow | null
  redeemGrant(raw: string): GrantRow | null

  issueRecoveryCodes(userId: string): string[]
  countRecoveryCodes(userId: string): number
  redeemRecoveryCode(userId: string, code: string): boolean
}

export function createAccountsStore(db: SqliteDatabase): AccountsStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                TEXT PRIMARY KEY,
      username          TEXT NOT NULL UNIQUE,
      display_name      TEXT NOT NULL,
      email             TEXT UNIQUE,
      email_verified_at TEXT,
      pw_hash           TEXT NOT NULL,
      role              TEXT NOT NULL DEFAULT 'member',
      created_at        TEXT NOT NULL,
      last_login_at     TEXT,
      disabled_at       TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash      TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS grants (
      token_hash TEXT PRIMARY KEY,
      kind       TEXT NOT NULL,
      user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
      role       TEXT,
      email      TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at    TEXT
    );
    CREATE TABLE IF NOT EXISTS recovery_codes (
      code_hash  TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      used_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_codes(user_id);
  `)

  const USER_COLS =
    'id, username, display_name, email, email_verified_at, role, created_at, last_login_at, disabled_at'

  const stmt = {
    anyUser: db.prepare('SELECT 1 FROM users LIMIT 1'),
    countOwners: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND disabled_at IS NULL"),
    insertUser: db.prepare(`
      INSERT INTO users (id, username, display_name, email, email_verified_at, pw_hash, role, created_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
    `),
    listUsers: db.prepare(`SELECT ${USER_COLS} FROM users ORDER BY created_at ASC`),
    getUser: db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`),
    findByLogin: db.prepare(`
      SELECT ${USER_COLS}, pw_hash FROM users
      WHERE username = ? OR (email IS NOT NULL AND email = ?)
    `),
    getHash: db.prepare('SELECT pw_hash FROM users WHERE id = ?'),
    setPassword: db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?'),
    setRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
    setDisabled: db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?'),
    setDisplayName: db.prepare('UPDATE users SET display_name = ? WHERE id = ?'),
    setUsername: db.prepare('UPDATE users SET username = ? WHERE id = ?'),
    usernameInUse: db.prepare('SELECT id FROM users WHERE username = ?'),
    setEmail: db.prepare('UPDATE users SET email = ?, email_verified_at = NULL WHERE id = ?'),
    verifyEmail: db.prepare(
      'UPDATE users SET email_verified_at = ? WHERE id = ? AND email = ?',
    ),
    recordLogin: db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?'),
    emailInUse: db.prepare('SELECT id FROM users WHERE email = ?'),

    insertSession: db.prepare(
      'INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, NULL)',
    ),
    selectSession: db.prepare(`
      SELECT u.id AS id, u.username AS username, u.display_name AS display_name,
             u.email AS email, u.email_verified_at AS email_verified_at, u.role AS role,
             u.created_at AS created_at, u.last_login_at AS last_login_at,
             u.disabled_at AS disabled_at, s.expires_at AS expires_at, s.last_seen_at AS last_seen_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ?
    `),
    touchSession: db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id_hash = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),

    insertGrant: db.prepare(`
      INSERT INTO grants (token_hash, kind, user_id, role, email, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    selectGrant: db.prepare(
      'SELECT kind, user_id, role, email, created_at, expires_at, used_at FROM grants WHERE token_hash = ?',
    ),
    useGrant: db.prepare('UPDATE grants SET used_at = ? WHERE token_hash = ? AND used_at IS NULL'),

    clearCodes: db.prepare('DELETE FROM recovery_codes WHERE user_id = ?'),
    insertCode: db.prepare(
      'INSERT INTO recovery_codes (code_hash, user_id, created_at) VALUES (?, ?, ?)',
    ),
    countCodes: db.prepare(
      'SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL',
    ),
    selectCode: db.prepare(
      'SELECT code_hash FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
    ),
    useCode: db.prepare('UPDATE recovery_codes SET used_at = ? WHERE code_hash = ?'),
  }

  const now = (): string => new Date().toISOString()

  function createSession(userId: string): string {
    const raw = newToken()
    stmt.insertSession.run(tokenHash(raw), userId, now(), now())
    return raw
  }

  /**
   * The user behind a cookie, or null.
   *
   * A disabled account resolves to null even though its sessions still exist —
   * disabling must take effect on the next request, not whenever the row is
   * eventually cleaned up. An `expires_at` of null means never (D2); a non-null
   * one in the past is honoured, so a policy can be added later without
   * touching this code.
   */
  function resolveSession(raw: string): UserRow | null {
    // Stryker disable next-line ConditionalExpression: a short-circuit, not a
    // rule — an empty token hashes to a value no session row carries, so the
    // lookup below returns null anyway.
    if (!raw) return null
    const row = stmt.selectSession.get(tokenHash(raw)) as
      | (UserRow & { expires_at: string | null; last_seen_at: string })
      | undefined
    if (!row) return null
    if (row.disabled_at) return null
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return null
    // Throttled hard: auto-save fires about once a second per open editor, and
    // a write per request against a single-writer SQLite file would be the most
    // expensive thing this app does.
    if (Date.now() - Date.parse(row.last_seen_at) > TOUCH_AFTER_MS) {
      stmt.touchSession.run(now(), tokenHash(raw))
    }
    return {
      id: row.id,
      username: row.username,
      display_name: row.display_name,
      email: row.email,
      email_verified_at: row.email_verified_at,
      role: row.role,
      created_at: row.created_at,
      last_login_at: row.last_login_at,
      disabled_at: row.disabled_at,
    }
  }

  function mintGrant(
    kind: GrantKind,
    opts?: { userId?: string; role?: Role; email?: string },
  ): string {
    const raw = newToken()
    const expires = new Date(Date.now() + GRANT_TTL_MS[kind]).toISOString()
    stmt.insertGrant.run(
      tokenHash(raw),
      kind,
      opts?.userId ?? null,
      opts?.role ?? null,
      opts?.email ?? null,
      now(),
      expires,
    )
    return raw
  }

  /** Read a grant without consuming it — for showing "who is this invite for". */
  function peekGrant(raw: string): GrantRow | null {
    if (!raw) return null
    const row = stmt.selectGrant.get(tokenHash(raw)) as
      | (GrantRow & { used_at: string | null })
      | undefined
    if (!row) return null
    if (row.used_at) return null
    if (Date.parse(row.expires_at) <= Date.now()) return null
    return { kind: row.kind, user_id: row.user_id, role: row.role, email: row.email, created_at: row.created_at, expires_at: row.expires_at }
  }

  /**
   * Consume a grant. The UPDATE carries `used_at IS NULL`, so two simultaneous
   * redemptions of one token cannot both succeed — the second changes no rows.
   */
  function redeemGrant(raw: string): GrantRow | null {
    const grant = peekGrant(raw)
    if (!grant) return null
    const result = stmt.useGrant.run(now(), tokenHash(raw))
    return result.changes === 1 ? grant : null
  }

  function issueRecoveryCodes(userId: string): string[] {
    const codes: string[] = []
    db.transaction(() => {
      stmt.clearCodes.run(userId)
      for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
        const code = newRecoveryCode()
        codes.push(code)
        stmt.insertCode.run(tokenHash(code), userId, now())
      }
    })()
    return codes
  }

  /**
   * Spend one code. Dashes and case are normalised because the human reading it
   * back off a screen will not reproduce the formatting exactly.
   */
  function redeemRecoveryCode(userId: string, code: string): boolean {
    if (typeof code !== 'string' || !code.trim()) return false
    const cleaned = code.trim().toUpperCase().replace(/[^0-9A-Z]/g, '')
    const grouped = (cleaned.match(/.{1,5}/g) ?? []).join('-')
    const hash = tokenHash(grouped)
    const row = stmt.selectCode.get(userId, hash) as { code_hash: string } | undefined
    if (!row || !hashEquals(row.code_hash, hash)) return false
    return stmt.useCode.run(now(), hash).changes === 1
  }

  return {
    hasAnyUser: () => stmt.anyUser.get() !== undefined,
    countOwners: () => (stmt.countOwners.get() as { n: number }).n,

    createUser(input: CreateUserInput): UserRow {
      const id = randomUUID()
      const username = normaliseLogin(input.username)
      const email = input.email ? normaliseLogin(input.email) : null
      stmt.insertUser.run(id, username, input.displayName, email, input.pwHash, input.role, now())
      return stmt.getUser.get(id) as UserRow
    },

    /**
     * Create the owner, but only while there is genuinely no user.
     *
     * The check and the insert must share a transaction with no `await`
     * between them. The bootstrap route hashes a password first — several
     * hundred milliseconds of scrypt — and two requests arriving inside that
     * window both saw "no users yet" and both created an owner, so one code
     * produced as many owners as there were concurrent requests carrying it.
     *
     * Node is single-threaded and this connection is synchronous, so a
     * transaction containing both steps cannot be interleaved. Hash BEFORE
     * calling this, never inside it.
     */
    createFirstOwner(input: Omit<CreateUserInput, 'role'>): UserRow | null {
      let created: UserRow | null = null
      db.transaction(() => {
        if (stmt.anyUser.get() !== undefined) return
        const id = randomUUID()
        stmt.insertUser.run(
          id,
          normaliseLogin(input.username),
          input.displayName,
          input.email ? normaliseLogin(input.email) : null,
          input.pwHash,
          'owner',
          now(),
        )
        created = stmt.getUser.get(id) as UserRow
      })()
      return created
    },

    listUsers: () => stmt.listUsers.all() as UserRow[],
    getUser: (id: string) => (stmt.getUser.get(id) as UserRow | undefined) ?? null,

    findByLogin(login: string): UserWithHash | null {
      const v = normaliseLogin(login)
      if (!v) return null
      return (stmt.findByLogin.get(v, v) as UserWithHash | undefined) ?? null
    },

    getHash: (id: string) =>
      ((stmt.getHash.get(id) as { pw_hash: string } | undefined)?.pw_hash) ?? null,

    /**
     * Set a password and end every session for that user. The two belong in one
     * call: a password change that leaves old sessions alive is exactly the
     * hole a password change is meant to close.
     */
    setPassword(userId: string, pwHash: string): void {
      db.transaction(() => {
        stmt.setPassword.run(pwHash, userId)
        stmt.deleteUserSessions.run(userId)
        // Recovery codes go too. A code is a STRONGER credential than a
        // session — long-lived, not tied to a browser, and on its own it sets a
        // new password — so leaving them alive meant a code harvested earlier
        // still worked after the victim had changed their password and believed
        // the incident closed.
        stmt.clearCodes.run(userId)
      })()
    },

    /**
     * Re-store the same password at the current cost.
     *
     * Distinct from `setPassword` precisely because it must NOT end sessions:
     * this runs during a successful login, and dropping every session there
     * would sign the user out at the moment they signed in. The credential has
     * not changed — only how expensively it is stored.
     */
    rehashPassword: (userId: string, pwHash: string) => { stmt.setPassword.run(pwHash, userId) },

    setRole: (userId: string, role: Role) => { stmt.setRole.run(role, userId) },

    setDisabled(userId: string, disabled: boolean): void {
      db.transaction(() => {
        stmt.setDisabled.run(disabled ? now() : null, userId)
        if (disabled) stmt.deleteUserSessions.run(userId)
      })()
    },

    setDisplayName: (userId: string, displayName: string) => {
      stmt.setDisplayName.run(displayName, userId)
    },

    /**
     * Rename the login identifier.
     *
     * Returns false rather than throwing on a collision: the UNIQUE constraint
     * would otherwise surface as a raw SQLite error on a route whose honest
     * answer is "that name is taken". Checked and written in one transaction so
     * two simultaneous renames cannot both see the name as free.
     */
    setUsername(userId: string, username: string): boolean {
      const next = normaliseLogin(username)
      let ok = false
      db.transaction(() => {
        const clash = stmt.usernameInUse.get(next) as { id: string } | undefined
        if (clash && clash.id !== userId) return
        stmt.setUsername.run(next, userId)
        ok = true
      })()
      return ok
    },

    usernameInUse(username: string, exceptUserId?: string): boolean {
      const row = stmt.usernameInUse.get(normaliseLogin(username)) as { id: string } | undefined
      return row !== undefined && row.id !== exceptUserId
    },

    /** Changing the address always clears verification — the new one is unproven. */
    setEmail: (userId: string, email: string | null) => {
      stmt.setEmail.run(email ? normaliseLogin(email) : null, userId)
    },

    /**
     * Verified only if the address still matches the one the link was issued
     * for; otherwise a verification minted for an old address would confirm
     * whatever the user has since typed in.
     */
    markEmailVerified: (userId: string, email: string) =>
      stmt.verifyEmail.run(now(), userId, normaliseLogin(email)).changes === 1,

    recordLogin: (userId: string) => { stmt.recordLogin.run(now(), userId) },

    emailInUse(email: string, exceptUserId?: string): boolean {
      const row = stmt.emailInUse.get(normaliseLogin(email)) as { id: string } | undefined
      return row !== undefined && row.id !== exceptUserId
    },

    createSession,
    resolveSession,
    touchSession: (raw: string) => { stmt.touchSession.run(now(), tokenHash(raw)) },
    deleteSession: (raw: string) => { stmt.deleteSession.run(tokenHash(raw)) },
    deleteUserSessions: (userId: string) => stmt.deleteUserSessions.run(userId).changes,

    mintGrant,
    peekGrant,
    redeemGrant,

    issueRecoveryCodes,
    countRecoveryCodes: (userId: string) =>
      (stmt.countCodes.get(userId) as { n: number }).n,
    redeemRecoveryCode,
  }
}
