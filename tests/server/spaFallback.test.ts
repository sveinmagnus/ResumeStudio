/**
 * The SPA fallback: every non-API route must serve index.html so a bookmarked
 * or reloaded deep URL boots the app instead of 404ing.
 *
 * This has now broken twice, both times invisibly:
 *
 *  1. `base: './'` in vite.config.ts made a deep load resolve `./assets/*`
 *     against `/r/`, and strict MIME checking refused to boot.
 *  2. `res.sendFile(absolutePath)` — `send` defaults to `dotfiles: 'ignore'`
 *     and applies it to the whole path, so ANY dot segment in the install path
 *     404'd the fallback. `/` kept working (express.static answers it before
 *     the fallback), so it looked like a routing bug rather than a path one.
 *
 * The `dotfiles` case is covered explicitly below, with a client dir under a
 * dot-directory — a plain temp dir passes either way, which is exactly why the
 * first version of this file did not actually guard the regression.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../server/app'

let clientDir: string

let baseDir: string

beforeAll(() => {
  // realpath: macOS hands back /var/... which is a symlink to /private/var/...,
  // and a mismatch there fails the served-file comparison for the wrong reason.
  baseDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rs-client-')))
  // Deliberately UNDER A DOT-DIRECTORY. A plain path passes with or without the
  // fix, so a plain path would test nothing: `send`'s dotfiles rule is what
  // broke, and it is triggered by the install path, not by the request.
  clientDir = path.join(baseDir, '.install', 'dist')
  fs.mkdirSync(path.join(clientDir, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><title>Resume Studio</title>')
  fs.writeFileSync(path.join(clientDir, 'assets', 'app.js'), 'console.log(1)')
})

afterAll(() => { fs.rmSync(baseDir, { recursive: true, force: true }) })

function app() {
  vi.stubEnv('RESUME_CLIENT_DIR', clientDir)
  vi.stubEnv('RESUME_DB_PATH', ':memory:')
  vi.stubEnv('RESUME_API_TOKEN', '')
  return createApp()
}

describe('SPA fallback', () => {
  it('serves index.html at the root', async () => {
    const res = await request(app()).get('/')
    expect(res.status).toBe(200)
    expect(res.text).toContain('Resume Studio')
  })

  it.each([
    ['/r/00000000-0000-0000-0000-000000000000'],
    ['/r/00000000-0000-0000-0000-000000000000/projects'],
    ['/r/00000000-0000-0000-0000-000000000000/views/abc'],
    ['/some/unknown/deep/path'],
  ])('serves index.html for a hard load of %s', async (url) => {
    const res = await request(app()).get(url)
    expect(res.status).toBe(200)
    expect(res.text).toContain('Resume Studio')
  })

  it('still serves real static assets rather than the fallback', async () => {
    const res = await request(app()).get('/assets/app.js')
    expect(res.status).toBe(200)
    expect(res.text).toContain('console.log(1)')
  })

  it('does NOT swallow unknown /api routes into the SPA', async () => {
    // An API 404 must stay a 404: answering it with HTML would turn a broken
    // fetch into a JSON parse error three layers away from the cause.
    const res = await request(app()).get('/api/nope')
    expect(res.status).toBe(404)
    expect(res.text).not.toContain('Resume Studio')
  })
})
