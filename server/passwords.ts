/**
 * Password hashing — `node:crypto`'s scrypt, no dependency.
 *
 * WHY NOT bcrypt/argon2: both are native addons, and `server/sqlite.ts` records
 * in detail what the last native addon cost this project (source compiles on
 * every toolchain-less machine, a release runner that cannot drive node-gyp).
 * scrypt is memory-hard, ships inside Node, and needs nothing vendored into the
 * desktop bundle.
 *
 * Two parameter facts that bite:
 *
 *  - scrypt's memory cost is `128 * N * r` bytes — 33.5 MB at the defaults
 *    below, which is ABOVE Node's 32 MB `maxmem` ceiling. Omit `maxmem` and
 *    every hash throws ERR_CRYPTO_INVALID_SCRYPT_PARAMS, so it is passed
 *    explicitly.
 *  - the async form is used everywhere. `scryptSync` at these parameters
 *    occupies the event loop for the whole derivation (measured between 0.3 s
 *    and 0.7 s depending on machine load), which would stall every other
 *    request — including the auto-save PUT of anyone else editing.
 *
 * The stored form carries its own parameters, so COST CAN BE RAISED without
 * invalidating existing hashes: verification uses whatever the stored string
 * says, and `needsRehash` reports when a hash predates the current cost so the
 * caller can silently upgrade it on the next successful login.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/**
 * Current cost. Raising N is the lever; it multiplies both time and memory, so
 * `MAXMEM` must stay above `128 * N * R`.
 */
const N = 32768
const R = 8
const P = 1
const KEY_BYTES = 32
const SALT_BYTES = 16
const MAXMEM = 64 * 1024 * 1024

/** Minimum length. Length only — current NIST guidance drops composition rules. */
export const PASSWORD_MIN_LENGTH = 12

interface ScryptParams {
  N: number
  r: number
  p: number
}

/** Promise wrapper — the callback form is the only async one Node offers. */
function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_BYTES,
      { N: params.N, r: params.r, p: params.p, maxmem: MAXMEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    )
  })
}

/**
 * `scrypt$N=32768,r=8,p=1$<salt>$<hash>`, both blobs base64url.
 *
 * Self-describing rather than a bare digest so the cost is a property of each
 * stored hash instead of a constant the whole table silently depends on.
 */
function encode(salt: Buffer, key: Buffer, params: ScryptParams): string {
  const p = `N=${params.N},r=${params.r},p=${params.p}`
  return `scrypt$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

interface ParsedHash {
  params: ScryptParams
  salt: Buffer
  key: Buffer
}

/** Null for anything not a well-formed hash of ours — callers treat it as a failed verify. */
function decode(stored: string): ParsedHash | null {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'scrypt') return null
  const params: ScryptParams = { N: 0, r: 0, p: 0 }
  for (const kv of parts[1].split(',')) {
    const eq = kv.indexOf('=')
    if (eq <= 0) return null
    const name = kv.slice(0, eq)
    const value = Number(kv.slice(eq + 1))
    if (!Number.isInteger(value) || value <= 0) return null
    if (name === 'N') params.N = value
    else if (name === 'r') params.r = value
    else if (name === 'p') params.p = value
    else return null
  }
  if (!params.N || !params.r || !params.p) return null
  // A crafted hash could otherwise name parameters whose memory cost exceeds
  // MAXMEM and turn every login attempt into a thrown error.
  if (128 * params.N * params.r > MAXMEM) return null
  try {
    const salt = Buffer.from(parts[2], 'base64url')
    const key = Buffer.from(parts[3], 'base64url')
    if (salt.length === 0 || key.length === 0) return null
    return { params, salt, key }
  } catch {
    return null
  }
}

/** Hash a new password at the current cost. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const params: ScryptParams = { N, r: R, p: P }
  const key = await derive(password, salt, params)
  return encode(salt, key, params)
}

/**
 * Verify against a stored hash, using the parameters that hash was made with.
 * Never throws: a malformed or unparseable stored value is a failed verify, not
 * a 500 on the login route.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = decode(stored)
  if (!parsed) return false
  try {
    const key = await derive(password, parsed.salt, parsed.params)
    if (key.length !== parsed.key.length) return false
    return timingSafeEqual(key, parsed.key)
  } catch {
    return false
  }
}

/** True when `stored` was made at a lower cost than the current one. */
export function needsRehash(stored: string): boolean {
  const parsed = decode(stored)
  if (!parsed) return true
  return parsed.params.N < N || parsed.params.r < R || parsed.params.p < P
}

/**
 * A hash no input can ever satisfy — for an account that exists but cannot be
 * signed into yet.
 *
 * Used by the legacy-token migration: a converted `RESUME_API_TOKENS` entry
 * becomes a real account, but the shared secret it came from must never keep
 * working as that person's password. The account waits for a reset link.
 *
 * Deliberately explicit rather than relying on "some malformed string happens
 * to fail to verify": the intent is legible at the call site, and `decode`
 * rejects it for a stated reason rather than by accident.
 */
export function lockedPasswordHash(): string {
  return `locked$${randomBytes(16).toString('base64url')}`
}

/** True when this account has no password anyone can present. */
export function isLockedPassword(stored: string): boolean {
  return stored.startsWith('locked$')
}

/** The reason `password` is unacceptable, or null when it is fine. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string') return 'Password must be text.'
  // Counted in code points: a length check on UTF-16 units would let an
  // emoji-heavy passphrase pass at half the characters it appears to have.
  if ([...password].length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
  }
  return null
}
