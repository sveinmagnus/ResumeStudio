/**
 * The one-time code that authorises creating the first account, and the same
 * mechanism reused for owner recovery.
 *
 * WHY A CODE AT ALL. The first account on a fresh server becomes the owner and
 * sees every CV. "First visitor becomes the owner" is a race that a port
 * scanner wins on a public IP, and the loss is total. Requiring a code moves
 * the trust boundary to "can you read this machine's console or log", which is
 * where it already sits — anyone who can do that can read `resume.db`.
 *
 * HELD IN MEMORY, NEVER PERSISTED. A restart issues a new code, so an old one
 * cannot be recovered from disk or from a backup of it. That also makes
 * "restart the server" the way to re-issue one, which is a thing an operator
 * can always do.
 *
 * This is deliberately not a grant row (`accounts.ts`): a grant needs a user to
 * belong to, and the whole point of this code is that no user exists yet.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'

/** Groups of five from an alphabet without the letters people misread. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function newCode(): string {
  const bytes = randomBytes(20)
  let out = ''
  for (let i = 0; i < 20; i++) {
    if (i > 0 && i % 5 === 0) out += '-'
    out += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return out
}

let current: string | null = null

/**
 * Issue (or re-issue) the code and return it for printing.
 *
 * Callers print it to stdout and the log — the two places an operator can reach
 * without already being inside the app.
 */
export function issueBootstrapCode(): string {
  current = newCode()
  return current
}

/** True once a code has been issued and not yet spent. */
export function hasBootstrapCode(): boolean {
  return current !== null
}

/** Forget the code. Called the moment it is successfully spent. */
export function clearBootstrapCode(): void {
  current = null
}

/**
 * Check a presented code in constant time.
 *
 * Normalised the same way recovery codes are, because it is read off a console
 * and retyped, and a user who drops the dashes has not made a mistake worth
 * failing over.
 */
export function bootstrapCodeMatches(presented: unknown): boolean {
  if (current === null || typeof presented !== 'string') return false
  const cleaned = presented.trim().toUpperCase().replace(/[^0-9A-Z]/g, '')
  const grouped = (cleaned.match(/.{1,5}/g) ?? []).join('-')
  const a = Buffer.from(grouped, 'utf8')
  const b = Buffer.from(current, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** The banner an operator reads. Kept here so both entry points print the same thing. */
export function bootstrapBanner(code: string, url: string): string {
  return [
    '',
    '  ┌─────────────────────────────────────────────────────────────┐',
    '  │  Resume Studio has no accounts yet.                         │',
    '  │  Open the app and use this one-time code to create the      │',
    '  │  first account, which becomes the owner:                    │',
    '  │                                                             │',
    `  │      ${code.padEnd(55)}│`,
    '  │                                                             │',
    `  │  ${url.padEnd(59)}│`,
    '  │                                                             │',
    '  │  The code changes every time the server restarts.           │',
    '  └─────────────────────────────────────────────────────────────┘',
    '',
  ].join('\n')
}
