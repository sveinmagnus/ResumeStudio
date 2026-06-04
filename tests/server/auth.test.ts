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
