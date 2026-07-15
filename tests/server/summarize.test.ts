import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  resolveConfig, isSummarizeConfigured, summarize, tidyLine, SummarizeError,
} from '../../server/summarize'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** A fetch mock resolving to a Response-ish object. */
function mockFetch(resp: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fn = vi.fn().mockResolvedValue(resp)
  vi.stubGlobal('fetch', fn)
  return fn
}

function chat(content: string) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) }
}

describe('tidyLine()', () => {
  it('strips fences, quotes, list markers and takes the first line', () => {
    expect(tidyLine('"Led the platform team."')).toBe('Led the platform team.')
    expect(tidyLine('- Built the payments service\nExtra rambling')).toBe('Built the payments service')
    expect(tidyLine('```\nHello\n```')).toBe('Hello')
  })
})

describe('isSummarizeConfigured()', () => {
  it('needs a model, and provider-specific config', () => {
    expect(isSummarizeConfigured({ provider: 'off', ollama: { url: '' }, openai: { apiKey: '' }, compat: { url: '', apiKey: '' }, model: 'x' })).toBe(false)
    // ollama always has a URL (default), so a model is enough.
    expect(isSummarizeConfigured({ provider: 'ollama', ollama: { url: 'http://localhost:11434' }, openai: { apiKey: '' }, compat: { url: '', apiKey: '' }, model: '' })).toBe(false)
    expect(isSummarizeConfigured({ provider: 'ollama', ollama: { url: 'http://localhost:11434' }, openai: { apiKey: '' }, compat: { url: '', apiKey: '' }, model: 'llama3.2' })).toBe(true)
    expect(isSummarizeConfigured({ provider: 'openai', ollama: { url: '' }, openai: { apiKey: 'sk-x' }, compat: { url: '', apiKey: '' }, model: 'gpt-4o-mini' })).toBe(true)
    expect(isSummarizeConfigured({ provider: 'openai', ollama: { url: '' }, openai: { apiKey: '' }, compat: { url: '', apiKey: '' }, model: 'gpt-4o-mini' })).toBe(false)
  })
})

describe('resolveConfig()', () => {
  it('reads the SUMMARIZE_* env vars', () => {
    vi.stubEnv('SUMMARIZE_PROVIDER', 'ollama')
    vi.stubEnv('SUMMARIZE_OLLAMA_URL', 'http://localhost:11434/')
    vi.stubEnv('SUMMARIZE_MODEL', 'llama3.2:3b')
    const c = resolveConfig()
    expect(c.provider).toBe('ollama')
    expect(c.ollama.url).toBe('http://localhost:11434') // trailing slash stripped
    expect(c.model).toBe('llama3.2:3b')
  })
})

describe('summarize()', () => {
  it('throws 503 when not configured', async () => {
    vi.stubEnv('SUMMARIZE_PROVIDER', 'off')
    const err = await summarize('long text', 'en').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SummarizeError)
    expect((err as SummarizeError).status).toBe(503)
  })

  it('posts to the ollama OpenAI-compatible endpoint and returns a tidy line', async () => {
    vi.stubEnv('SUMMARIZE_PROVIDER', 'ollama')
    vi.stubEnv('SUMMARIZE_OLLAMA_URL', 'http://localhost:11434')
    vi.stubEnv('SUMMARIZE_MODEL', 'llama3.2')
    const fn = mockFetch(chat('  "Led a cloud migration for a bank."  '))
    const out = await summarize('A long description of the work…', 'no')
    expect(out).toBe('Led a cloud migration for a bank.')

    const [url, opts] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
    const body = JSON.parse(opts.body as string)
    expect(body.model).toBe('llama3.2')
    // Norwegian output requested in the system prompt.
    expect(body.messages[0].content).toContain('Norwegian')
    // Ollama needs no auth header.
    expect((opts.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('sends a Bearer key for OpenAI', async () => {
    vi.stubEnv('SUMMARIZE_PROVIDER', 'openai')
    vi.stubEnv('SUMMARIZE_OPENAI_API_KEY', 'sk-secret')
    vi.stubEnv('SUMMARIZE_MODEL', 'gpt-4o-mini')
    const fn = mockFetch(chat('Short.'))
    await summarize('text', 'en')
    const [url, opts] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret')
  })

  it('maps a 401 to a 502 key-rejected error', async () => {
    vi.stubEnv('SUMMARIZE_PROVIDER', 'openai')
    vi.stubEnv('SUMMARIZE_OPENAI_API_KEY', 'bad')
    vi.stubEnv('SUMMARIZE_MODEL', 'gpt-4o-mini')
    mockFetch({ ok: false, status: 401 })
    const err = await summarize('text', 'en').catch((e: unknown) => e)
    expect((err as SummarizeError).status).toBe(502)
    expect((err as SummarizeError).message).toMatch(/rejected the API key/i)
  })
})
