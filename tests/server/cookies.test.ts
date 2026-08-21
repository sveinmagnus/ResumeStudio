import { describe, it, expect, afterEach } from 'vitest'
import type { Request } from 'express'
import {
  isSecureRequest, buildCookie, sessionCookie, clearCookie, mayLoseSecureFlag,
} from '../../server/cookies'

/**
 * The bug this pins: the `Secure` flag was decided from `NODE_ENV`, not from
 * the connection.
 *
 * A production server on plain http — a LAN box, an internal tool without TLS —
 * therefore set `Secure` on a cookie the browser then discarded. Safari is
 * strictest about it, so signing in there "succeeded" and returned the user to
 * the form, forever, with no error ever shown. Chrome and Firefox hid the same
 * defect behind their trustworthy-origin exemption for `http://localhost`,
 * which does not extend to an arbitrary host.
 */

const req = (secure: boolean) => ({ secure }) as unknown as Request

afterEach(() => {
  delete process.env.NODE_ENV
  delete process.env.RESUME_TRUST_PROXY
})

describe('isSecureRequest', () => {
  it('follows the connection', () => {
    expect(isSecureRequest(req(true))).toBe(true)
    expect(isSecureRequest(req(false))).toBe(false)
  })

  it('ignores NODE_ENV entirely — that was the bug', () => {
    process.env.NODE_ENV = 'production'
    expect(isSecureRequest(req(false))).toBe(false)
  })

  it('does not read X-Forwarded-Proto itself', () => {
    // Without `trust proxy` that header is attacker-supplied. Express already
    // gates it; reading it here would let a client talk the server into
    // believing a plaintext connection was secure.
    const spoofed = {
      secure: false,
      headers: { 'x-forwarded-proto': 'https' },
    } as unknown as Request
    expect(isSecureRequest(spoofed)).toBe(false)
  })
})

describe('buildCookie', () => {
  it('marks Secure over https', () => {
    expect(buildCookie(req(true), 'a', 'b')).toContain('Secure')
  })

  it('omits Secure over http, so the browser keeps the cookie', () => {
    expect(buildCookie(req(false), 'a', 'b')).not.toContain('Secure')
  })

  it('is HttpOnly and SameSite=Strict by default', () => {
    const c = buildCookie(req(true), 'a', 'b')
    expect(c).toContain('HttpOnly')
    expect(c).toContain('SameSite=Strict')
  })

  it('can opt out of HttpOnly, which the CSRF token must', () => {
    expect(buildCookie(req(true), 'a', 'b', { httpOnly: false })).not.toContain('HttpOnly')
  })

  it('percent-encodes the value', () => {
    expect(buildCookie(req(false), 'a', 'x y;z')).toContain('a=x%20y%3Bz')
  })

  it('emits the whole header, attributes and separators included', () => {
    /*
     * Asserted WHOLE, because every other case here matches a fragment and a
     * fragment match cannot see structure. Two mutants proved it: dropping
     * `Path=/` left them all green while scoping the session cookie to whatever
     * path it was set on — so a cookie issued at /api/auth/login would not be
     * sent to /api/resumes — and replacing the '; ' separator with '' produced
     * `a=bPath=/SameSite=StrictHttpOnly`, which `toContain('HttpOnly')` still
     * accepts and no browser does.
     */
    expect(buildCookie(req(false), 'a', 'b')).toBe('a=b; Path=/; SameSite=Strict; HttpOnly')
    expect(buildCookie(req(true), 'a', 'b')).toBe('a=b; Path=/; SameSite=Strict; HttpOnly; Secure')
  })
})

describe('sessionCookie', () => {
  it('carries no Max-Age — sessions do not expire on a clock (D2)', () => {
    expect(sessionCookie(req(true), 'rs_session', 'sid')).not.toContain('Max-Age')
  })
})

describe('clearCookie', () => {
  it('expires immediately and matches the original attributes', () => {
    const c = clearCookie(req(true), 'rs_session')
    expect(c).toContain('Max-Age=0')
    // A clear that disagreed on Secure or SameSite would not replace the cookie
    // it is meant to remove.
    expect(c).toContain('Secure')
    expect(c).toContain('SameSite=Strict')
  })

  it('blanks the value as well as expiring it', () => {
    // Max-Age=0 is what removes it, but a clear that left the old session id in
    // the header hands it back to anything reading Set-Cookie on the way out.
    expect(clearCookie(req(false), 'rs_session'))
      .toBe('rs_session=; Path=/; SameSite=Strict; HttpOnly; Max-Age=0')
  })
})

describe('mayLoseSecureFlag', () => {
  it('warns on a production server with no trust-proxy setting', () => {
    process.env.NODE_ENV = 'production'
    expect(mayLoseSecureFlag()).toBe(true)
  })

  it('still warns when trust proxy is set to whitespace', () => {
    // `RESUME_TRUST_PROXY='   '` configures nothing, and treating it as
    // configured would silence the one warning an operator terminating TLS
    // upstream gets before their sessions quietly stop being Secure.
    process.env.NODE_ENV = 'production'
    process.env.RESUME_TRUST_PROXY = '   '
    expect(mayLoseSecureFlag()).toBe(true)
  })

  it('stays quiet once trust proxy is configured', () => {
    process.env.NODE_ENV = 'production'
    process.env.RESUME_TRUST_PROXY = '1'
    expect(mayLoseSecureFlag()).toBe(false)
  })

  it('stays quiet in development, where plain http is the point', () => {
    expect(mayLoseSecureFlag()).toBe(false)
  })
})
