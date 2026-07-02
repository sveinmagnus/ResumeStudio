import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { authMiddleware } from '../../server/auth'

afterEach(() => vi.unstubAllEnvs())

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request
}

function makeRes() {
  const state = { statusCode: 0, body: undefined as unknown }
  const res = {
    locals: {} as Record<string, unknown>,
    status(code: number) { state.statusCode = code; return this },
    json(payload: unknown) { state.body = payload; return this },
  } as unknown as Response
  return { res, state }
}

describe('authMiddleware', () => {
  it('passes through when no token is configured (local dev)', () => {
    vi.stubEnv('RESUME_API_TOKEN', '')
    const { res, state } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    authMiddleware(makeReq(), res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(state.statusCode).toBe(0)
  })

  it('accepts the correct bearer token', () => {
    vi.stubEnv('RESUME_API_TOKEN', 's3kret')
    const { res } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    authMiddleware(makeReq({ authorization: 'Bearer s3kret' }), res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('rejects a missing Authorization header with a generic 401', () => {
    vi.stubEnv('RESUME_API_TOKEN', 's3kret')
    const { res, state } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    authMiddleware(makeReq(), res, next)
    expect(next).not.toHaveBeenCalled()
    expect(state.statusCode).toBe(401)
    expect(state.body).toEqual({ error: 'Unauthorized' })
  })

  it('rejects a wrong token', () => {
    vi.stubEnv('RESUME_API_TOKEN', 's3kret')
    const { res, state } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    authMiddleware(makeReq({ authorization: 'Bearer nope' }), res, next)
    expect(next).not.toHaveBeenCalled()
    expect(state.statusCode).toBe(401)
  })

  it('treats a cookie with a malformed percent-escape as a bad token (401, not a thrown 500)', () => {
    vi.stubEnv('RESUME_API_TOKEN', 's3kret')
    const { res, state } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    // `%zz` is an invalid escape — decodeURIComponent would throw. The parser
    // must fall back to the raw value so this resolves to a clean 401.
    expect(() =>
      authMiddleware(makeReq({ cookie: 'rs_token=%zz' }), res, next),
    ).not.toThrow()
    expect(next).not.toHaveBeenCalled()
    expect(state.statusCode).toBe(401)
  })

  it('accepts the correct token from the session cookie', () => {
    vi.stubEnv('RESUME_API_TOKEN', 's3kret')
    const { res } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    authMiddleware(makeReq({ cookie: 'rs_token=s3kret' }), res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  // ── Named tokens (F10: RESUME_API_TOKENS=name:token,…) ────────────────────

  it('accepts a named token and exposes the name for attribution', () => {
    vi.stubEnv('RESUME_API_TOKEN', '')
    vi.stubEnv('RESUME_API_TOKENS', 'kari:tok-kari,ola:tok-ola')
    const { res } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    authMiddleware(makeReq({ authorization: 'Bearer tok-ola' }), res, next)
    expect(next).toHaveBeenCalledOnce()
    expect((res.locals as { userName?: string | null }).userName).toBe('ola')
  })

  it('requires auth when only named tokens are configured', () => {
    vi.stubEnv('RESUME_API_TOKEN', '')
    vi.stubEnv('RESUME_API_TOKENS', 'kari:tok-kari')
    const { res, state } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    authMiddleware(makeReq(), res, next)
    expect(next).not.toHaveBeenCalled()
    expect(state.statusCode).toBe(401)
  })

  it('the single token still works beside named tokens, anonymously', () => {
    vi.stubEnv('RESUME_API_TOKEN', 's3kret')
    vi.stubEnv('RESUME_API_TOKENS', 'kari:tok-kari')
    const { res } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    authMiddleware(makeReq({ authorization: 'Bearer s3kret' }), res, next)
    expect(next).toHaveBeenCalledOnce()
    expect((res.locals as { userName?: string | null }).userName).toBeNull()
  })

  it('rejects a wrong token against named tokens', () => {
    vi.stubEnv('RESUME_API_TOKEN', '')
    vi.stubEnv('RESUME_API_TOKENS', 'kari:tok-kari')
    const { res, state } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    authMiddleware(makeReq({ authorization: 'Bearer tok-nope' }), res, next)
    expect(state.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('skips malformed name:token pairs without breaking valid ones', () => {
    vi.stubEnv('RESUME_API_TOKEN', '')
    vi.stubEnv('RESUME_API_TOKENS', 'no-colon-here,:empty-name,empty-token:,kari:tok-kari')
    const { res } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    authMiddleware(makeReq({ authorization: 'Bearer tok-kari' }), res, next)
    expect(next).toHaveBeenCalledOnce()
    expect((res.locals as { userName?: string | null }).userName).toBe('kari')
  })

  it('a malformed pair value is not accepted as a token', () => {
    vi.stubEnv('RESUME_API_TOKEN', '')
    vi.stubEnv('RESUME_API_TOKENS', 'kari:tok-kari')
    const { res, state } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    authMiddleware(makeReq({ authorization: 'Bearer kari:tok-kari' }), res, next)
    expect(state.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects a malformed (non-Bearer) header', () => {
    vi.stubEnv('RESUME_API_TOKEN', 's3kret')
    const { res, state } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    authMiddleware(makeReq({ authorization: 's3kret' }), res, next)
    expect(next).not.toHaveBeenCalled()
    expect(state.statusCode).toBe(401)
  })

  it('accepts a valid session cookie', () => {
    vi.stubEnv('RESUME_API_TOKEN', 's3kret')
    const { res } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    authMiddleware(makeReq({ cookie: 'rs_token=s3kret' }), res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('accepts a valid session cookie alongside other cookies', () => {
    vi.stubEnv('RESUME_API_TOKEN', 's3kret')
    const { res } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    authMiddleware(makeReq({ cookie: 'foo=bar; rs_token=s3kret; baz=qux' }), res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('rejects a wrong session cookie with a generic 401', () => {
    vi.stubEnv('RESUME_API_TOKEN', 's3kret')
    const { res, state } = makeRes()
    const next = vi.fn() as unknown as NextFunction
    authMiddleware(makeReq({ cookie: 'rs_token=nope' }), res, next)
    expect(next).not.toHaveBeenCalled()
    expect(state.statusCode).toBe(401)
    expect(state.body).toEqual({ error: 'Unauthorized' })
  })

  it('does not leak whether the token length matched (same 401 either way)', () => {
    vi.stubEnv('RESUME_API_TOKEN', 's3kret')
    const short = makeRes()
    const long = makeRes()
    const next = vi.fn() as unknown as NextFunction
    authMiddleware(makeReq({ authorization: 'Bearer x' }), short.res, next)
    authMiddleware(makeReq({ authorization: 'Bearer waytoolongtokenvalue' }), long.res, next)
    expect(short.state.body).toEqual({ error: 'Unauthorized' })
    expect(long.state.body).toEqual({ error: 'Unauthorized' })
  })
})
