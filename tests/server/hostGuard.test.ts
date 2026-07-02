import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { isLoopbackHost } from '../../server/app'

// The DNS-rebinding guard (server/app.ts) pins the Host header to a loopback
// name on the auth-less desktop build, so an attacker page that rebinds its own
// hostname to 127.0.0.1 (slipping past the Sec-Fetch-Site brake as
// 'same-origin') is still rejected. Only armed when RESUME_DESKTOP is set.

describe('isLoopbackHost()', () => {
  it('accepts loopback hostnames with or without a port', () => {
    for (const h of ['127.0.0.1', '127.0.0.1:3001', 'localhost', 'localhost:5173', '[::1]', '[::1]:3001']) {
      expect(isLoopbackHost(h)).toBe(true)
    }
  })

  it('rejects non-loopback hosts, empties, and rebind lookalikes', () => {
    for (const h of [undefined, '', 'evil.example', 'evil.example:3001', '10.0.0.5:3001', '127.0.0.1.evil.example', 'localhost.evil.example']) {
      expect(isLoopbackHost(h)).toBe(false)
    }
  })
})

describe('desktop DNS-rebinding guard', () => {
  let app: Express

  beforeAll(async () => {
    process.env.RESUME_DB_PATH = ':memory:'
    process.env.RESUME_RATE_LIMIT_MAX = '1000000'
    process.env.RESUME_DESKTOP = '1'       // arm the guard
    delete process.env.RESUME_API_TOKEN    // auth disabled (the desktop case)
    const { createApp } = await import('../../server/app')
    app = createApp()
  })

  afterAll(() => {
    for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX', 'RESUME_DESKTOP']) delete process.env[k]
  })

  it('rejects a request whose Host is not loopback with 403', async () => {
    const res = await request(app).get('/api/health').set('Host', 'evil.example')
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Invalid host' })
  })

  it('allows a request with a loopback Host', async () => {
    const res = await request(app).get('/api/health').set('Host', '127.0.0.1:3001')
    expect(res.status).toBe(200)
  })

  it('blocks a rebinding read attempt at a data route too', async () => {
    const res = await request(app).get('/api/resumes').set('Host', 'attacker.test')
    expect(res.status).toBe(403)
  })
})

describe('host guard is disarmed off the desktop build', () => {
  let app: Express

  beforeAll(async () => {
    process.env.RESUME_DB_PATH = ':memory:'
    process.env.RESUME_RATE_LIMIT_MAX = '1000000'
    delete process.env.RESUME_DESKTOP     // VPS/dev: guard off
    delete process.env.RESUME_API_TOKEN
    const { createApp } = await import('../../server/app')
    app = createApp()
  })

  afterAll(() => {
    for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX']) delete process.env[k]
  })

  it('does not reject an arbitrary Host when RESUME_DESKTOP is unset', async () => {
    const res = await request(app).get('/api/health').set('Host', 'resume.cartavio.no')
    expect(res.status).toBe(200)
  })
})
