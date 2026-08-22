import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * RESUME_TRUST_PROXY becomes Express's `trust proxy` setting — or nothing.
 *
 * Both halves of the Safari/TLS fix depend on this wiring and neither had a
 * test: `req.secure` (which decides the cookie's Secure flag) and `req.ip`
 * (which keys the rate limiter) only read X-Forwarded-* when the setting is on.
 * Set it when it should be off and a spoofed header marks any request secure
 * and lets one client rotate limiter identities; leave it off when it should be
 * on and every user behind the proxy shares one bucket, so one attacker's flood
 * 429s the whole team.
 *
 * A fresh module registry per case, because createApp reads env at call time
 * but the surrounding modules memoize.
 */
async function appWith(value: string | undefined): Promise<import('express').Express> {
  vi.resetModules()
  vi.stubEnv('RESUME_DB_PATH', ':memory:')
  if (value === undefined) vi.stubEnv('RESUME_TRUST_PROXY', '')
  else vi.stubEnv('RESUME_TRUST_PROXY', value)
  const { createApp } = await import('../../server/app')
  return createApp()
}

beforeEach(() => { vi.unstubAllEnvs() })

describe('the trust proxy setting', () => {
  it('is OFF by default — a spoofable header is never trusted unbidden', async () => {
    const app = await appWith(undefined)
    expect(app.get('trust proxy')).toBeFalsy()
  })

  it('reads a hop count as a NUMBER, which Express treats differently from a string', async () => {
    const app = await appWith('1')
    expect(app.get('trust proxy')).toBe(1)
  })

  it('reads "true" as the boolean', async () => {
    const app = await appWith('true')
    expect(app.get('trust proxy')).toBe(true)
  })

  it('passes an Express preset through as text', async () => {
    const app = await appWith('loopback')
    expect(app.get('trust proxy')).toBe('loopback')
  })

  it('treats whitespace as unset, matching the startup warning', async () => {
    // cookies.ts warns when the variable is blank; configuring Express from the
    // same blank would make the warning lie.
    const app = await appWith('   ')
    expect(app.get('trust proxy')).toBeFalsy()
  })
})
