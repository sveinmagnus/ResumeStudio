import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

let app: Express

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  delete process.env.RESUME_API_TOKEN
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'
  const { createApp } = await import('../../server/app')
  app = createApp()
})

afterAll(() => { delete process.env.RESUME_RATE_LIMIT_MAX })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

/** Point the server at a fake OpenAI-compatible endpoint. */
function configureLocal() {
  vi.stubEnv('SUMMARIZE_PROVIDER', 'ollama')
  vi.stubEnv('SUMMARIZE_OLLAMA_URL', 'http://localhost:11434')
  vi.stubEnv('SUMMARIZE_MODEL', 'llama3.2:3b')
}
const chat = (content: string) => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) })

describe('GET /api/summarize/status', () => {
  it('reports the model and that a localhost endpoint is local', async () => {
    configureLocal()
    const res = await request(app).get('/api/summarize/status')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      configured: true, provider: 'ollama', model: 'llama3.2:3b', local: true,
    })
  })

  it('reports a hosted endpoint as NOT local', async () => {
    vi.stubEnv('SUMMARIZE_PROVIDER', 'openai')
    vi.stubEnv('SUMMARIZE_OPENAI_API_KEY', 'sk-test')
    vi.stubEnv('SUMMARIZE_MODEL', 'gpt-4o-mini')
    const res = await request(app).get('/api/summarize/status')
    expect(res.body).toMatchObject({ configured: true, provider: 'openai', local: false })
  })

  it('treats an OpenAI-compatible endpoint on localhost as local (LM Studio)', async () => {
    // `local` follows the HOST, not the provider name — LM Studio on this
    // machine is as private as Ollama.
    vi.stubEnv('SUMMARIZE_PROVIDER', 'compat')
    vi.stubEnv('SUMMARIZE_COMPAT_URL', 'http://localhost:1234/v1')
    vi.stubEnv('SUMMARIZE_MODEL', 'local-model')
    const res = await request(app).get('/api/summarize/status')
    expect(res.body).toMatchObject({ configured: true, local: true })
  })

  it('treats a REMOTE ollama as not local', async () => {
    vi.stubEnv('SUMMARIZE_PROVIDER', 'ollama')
    vi.stubEnv('SUMMARIZE_OLLAMA_URL', 'http://gpu-box.example.com:11434')
    vi.stubEnv('SUMMARIZE_MODEL', 'llama3.1:8b')
    const res = await request(app).get('/api/summarize/status')
    expect(res.body).toMatchObject({ local: false })
  })

  it('says nothing is configured, and leaks no model name, when off', async () => {
    vi.stubEnv('SUMMARIZE_PROVIDER', 'off')
    const res = await request(app).get('/api/summarize/status')
    expect(res.body).toEqual({ configured: false, provider: '', model: '', local: false })
  })
})

describe('POST /api/llm/complete', () => {
  it('runs the prompt and returns the reply verbatim', async () => {
    configureLocal()
    const fn = vi.fn().mockResolvedValue(chat('{"schema":"x"}'))
    vi.stubGlobal('fetch', fn)

    const res = await request(app).post('/api/llm/complete').send({ prompt: 'do the thing' })
    expect(res.status).toBe(200)
    // Verbatim: each caller has its own validator; parsing here would be a
    // second, weaker copy of it.
    expect(res.body).toEqual({ text: '{"schema":"x"}' })

    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages).toEqual([{ role: 'user', content: 'do the thing' }])
    // Structured answers, not creative ones.
    expect(body.temperature).toBe(0)
  })

  it('rejects an empty or missing prompt', async () => {
    configureLocal()
    expect((await request(app).post('/api/llm/complete').send({})).status).toBe(400)
    expect((await request(app).post('/api/llm/complete').send({ prompt: '   ' })).status).toBe(400)
  })

  it('rejects an oversized prompt rather than forwarding it', async () => {
    configureLocal()
    const fn = vi.fn()
    vi.stubGlobal('fetch', fn)
    const res = await request(app).post('/api/llm/complete').send({ prompt: 'x'.repeat(60_001) })
    expect(res.status).toBe(413)
    expect(fn).not.toHaveBeenCalled()
  })

  it('caps max_tokens so one request cannot generate forever', async () => {
    configureLocal()
    const fn = vi.fn().mockResolvedValue(chat('ok'))
    vi.stubGlobal('fetch', fn)
    await request(app).post('/api/llm/complete').send({ prompt: 'p', max_tokens: 999_999 })
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.max_tokens).toBeLessThanOrEqual(4096)
  })

  it('503s when no model is configured', async () => {
    vi.stubEnv('SUMMARIZE_PROVIDER', 'off')
    const res = await request(app).post('/api/llm/complete').send({ prompt: 'p' })
    expect(res.status).toBe(503)
  })

  it('maps an upstream failure to a safe error without leaking internals', async () => {
    configureLocal()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    const res = await request(app).post('/api/llm/complete').send({ prompt: 'p' })
    expect(res.status).toBe(502)
    expect(JSON.stringify(res.body)).not.toContain('11434')
  })

  it('never lets the request choose the endpoint (no SSRF surface)', async () => {
    configureLocal()
    const fn = vi.fn().mockResolvedValue(chat('ok'))
    vi.stubGlobal('fetch', fn)
    await request(app).post('/api/llm/complete').send({
      prompt: 'p', baseUrl: 'http://evil.example.com', model: 'pwn',
    })
    // Endpoint + model come from server config; the body's attempts are ignored.
    expect(fn.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions')
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe('llama3.2:3b')
  })
})
