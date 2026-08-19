import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  resolveConfig, isLlmConfigured, isHighEndConfigured, llmInfo, chatComplete, LlmError,
  languageNameOf, languageName, languageDirective,
  type LlmConfig,
} from '../../server/llm'

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

/** An OpenAI Chat Completions success body. */
function chat(content: string) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) }
}

/** An Anthropic Messages success body. */
function claude(text: string) {
  return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) }
}

/** A full LlmConfig with overrides — every provider slot present. */
function cfg(over: Partial<LlmConfig> = {}): LlmConfig {
  return {
    provider: 'off',
    ollama: { url: '' }, openai: { apiKey: '' }, compat: { url: '', apiKey: '' },
    anthropic: { apiKey: '' }, gemini: { apiKey: '' }, mistral: { apiKey: '' },
    model: '', highEnd: false, ...over,
  }
}

/** One user message — the shape /api/llm/complete sends. */
const ASK = [{ role: 'user' as const, content: 'text' }]

describe('isLlmConfigured()', () => {
  it('needs a model, and provider-specific config', () => {
    expect(isLlmConfigured(cfg({ provider: 'off', model: 'x' }))).toBe(false)
    // ollama always has a URL (default), so a model is enough.
    expect(isLlmConfigured(cfg({ provider: 'ollama', ollama: { url: 'http://localhost:11434' }, model: '' }))).toBe(false)
    expect(isLlmConfigured(cfg({ provider: 'ollama', ollama: { url: 'http://localhost:11434' }, model: 'llama3.2' }))).toBe(true)
    expect(isLlmConfigured(cfg({ provider: 'openai', openai: { apiKey: 'sk-x' }, model: 'gpt-4o-mini' }))).toBe(true)
    expect(isLlmConfigured(cfg({ provider: 'openai', model: 'gpt-4o-mini' }))).toBe(false)
  })

  it('hosted providers are configured on an API key alone (default model)', () => {
    expect(isLlmConfigured(cfg({ provider: 'anthropic', anthropic: { apiKey: 'k' } }))).toBe(true)
    expect(isLlmConfigured(cfg({ provider: 'gemini', gemini: { apiKey: 'k' } }))).toBe(true)
    expect(isLlmConfigured(cfg({ provider: 'mistral', mistral: { apiKey: 'k' } }))).toBe(true)
    // …but not without the key.
    expect(isLlmConfigured(cfg({ provider: 'anthropic' }))).toBe(false)
  })
})

describe('isHighEndConfigured()', () => {
  it('needs BOTH a working config and the declaration', () => {
    const base = { provider: 'anthropic' as const, anthropic: { apiKey: 'k' } }
    expect(isHighEndConfigured(cfg({ ...base, highEnd: true }))).toBe(true)
    expect(isHighEndConfigured(cfg({ ...base, highEnd: false }))).toBe(false)
    // Declared high-end but nothing configured is still not high-end: the
    // advanced gate must never open on a backend that can't run anything.
    expect(isHighEndConfigured(cfg({ provider: 'anthropic', highEnd: true }))).toBe(false)
    expect(isHighEndConfigured(cfg({ provider: 'off', highEnd: true }))).toBe(false)
  })
})

describe('llmInfo()', () => {
  it('reports local/high_end, and leaks no model name when off', () => {
    const off = llmInfo(cfg({ provider: 'off', model: 'secret-model', highEnd: true }))
    expect(off).toEqual({ configured: false, provider: '', model: '', local: false, high_end: false })

    const local = llmInfo(cfg({
      provider: 'ollama', ollama: { url: 'http://localhost:11434' }, model: 'llama3.2', highEnd: true,
    }))
    expect(local).toMatchObject({ configured: true, local: true, high_end: true, model: 'llama3.2' })

    const hosted = llmInfo(cfg({ provider: 'openai', openai: { apiKey: 'k' }, model: 'gpt-4o-mini' }))
    expect(hosted).toMatchObject({ configured: true, local: false, high_end: false })
  })
})

describe('resolveConfig()', () => {
  it('reads the LLM_* env vars', () => {
    vi.stubEnv('LLM_PROVIDER', 'ollama')
    vi.stubEnv('LLM_OLLAMA_URL', 'http://localhost:11434/')
    vi.stubEnv('LLM_MODEL', 'llama3.2:3b')
    const c = resolveConfig()
    expect(c.provider).toBe('ollama')
    // Trailing slash stripped
    expect(c.ollama.url).toBe('http://localhost:11434')
    expect(c.model).toBe('llama3.2:3b')
  })

  it('reads the hosted-provider API keys', () => {
    vi.stubEnv('LLM_ANTHROPIC_API_KEY', 'a')
    vi.stubEnv('LLM_GEMINI_API_KEY', 'g')
    vi.stubEnv('LLM_MISTRAL_API_KEY', 'm')
    const c = resolveConfig()
    expect(c.anthropic.apiKey).toBe('a')
    expect(c.gemini.apiKey).toBe('g')
    expect(c.mistral.apiKey).toBe('m')
  })

  it('falls back to the pre-rename SUMMARIZE_* names', () => {
    // A deployment configured before the rename must keep working — losing an
    // API key silently on upgrade is a bad way to find out about a refactor.
    vi.stubEnv('SUMMARIZE_PROVIDER', 'openai')
    vi.stubEnv('SUMMARIZE_OPENAI_API_KEY', 'sk-old')
    vi.stubEnv('SUMMARIZE_MODEL', 'gpt-4o-mini')
    const c = resolveConfig()
    expect(c.provider).toBe('openai')
    expect(c.openai.apiKey).toBe('sk-old')
    expect(c.model).toBe('gpt-4o-mini')
  })

  it('prefers the new name when both are set', () => {
    vi.stubEnv('SUMMARIZE_MODEL', 'old')
    vi.stubEnv('LLM_MODEL', 'new')
    expect(resolveConfig().model).toBe('new')
  })

  it('reads the high-end flag as a truthy word, defaulting to false', () => {
    expect(resolveConfig().highEnd).toBe(false)
    vi.stubEnv('LLM_HIGH_END', '1')
    expect(resolveConfig().highEnd).toBe(true)
    vi.stubEnv('LLM_HIGH_END', 'true')
    expect(resolveConfig().highEnd).toBe(true)
    // Anything else is off — notably the string "false", which is truthy in JS
    // and would otherwise open the advanced gate by accident.
    vi.stubEnv('LLM_HIGH_END', 'false')
    expect(resolveConfig().highEnd).toBe(false)
    vi.stubEnv('LLM_HIGH_END', '0')
    expect(resolveConfig().highEnd).toBe(false)
  })
})

describe('chatComplete()', () => {
  it('throws 503 when not configured', async () => {
    vi.stubEnv('LLM_PROVIDER', 'off')
    const err = await chatComplete(ASK, { maxTokens: 50 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect((err as LlmError).status).toBe(503)
  })

  it('posts to the ollama OpenAI-compatible endpoint with no auth header', async () => {
    vi.stubEnv('LLM_PROVIDER', 'ollama')
    vi.stubEnv('LLM_OLLAMA_URL', 'http://localhost:11434')
    vi.stubEnv('LLM_MODEL', 'llama3.2')
    const fn = mockFetch(chat('  Led a cloud migration for a bank.  '))
    const out = await chatComplete(ASK, { maxTokens: 50 })
    expect(out.trim()).toBe('Led a cloud migration for a bank.')

    const [url, opts] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
    expect(JSON.parse(opts.body as string).model).toBe('llama3.2')
    expect((opts.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('sends a Bearer key for OpenAI', async () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')
    vi.stubEnv('LLM_OPENAI_API_KEY', 'sk-secret')
    vi.stubEnv('LLM_MODEL', 'gpt-4o-mini')
    const fn = mockFetch(chat('Short.'))
    await chatComplete(ASK, { maxTokens: 50 })
    const [url, opts] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret')
  })

  it('posts to Google\'s OpenAI-compat endpoint (Bearer) for gemini', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini')
    vi.stubEnv('LLM_GEMINI_API_KEY', 'g-key')
    const fn = mockFetch(chat('Short.'))
    await chatComplete(ASK, { maxTokens: 50 })
    const [url, opts] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer g-key')
  })

  it('posts to the Mistral API (Bearer) for mistral', async () => {
    vi.stubEnv('LLM_PROVIDER', 'mistral')
    vi.stubEnv('LLM_MISTRAL_API_KEY', 'm-key')
    const fn = mockFetch(chat('Short.'))
    await chatComplete(ASK, { maxTokens: 50 })
    const [url, opts] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions')
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer m-key')
  })

  it('uses the native Anthropic Messages API: x-api-key, version header, top-level system, no temperature', async () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    vi.stubEnv('LLM_ANTHROPIC_API_KEY', 'sk-ant-xxx')
    vi.stubEnv('LLM_MODEL', 'claude-haiku-4-5')
    const fn = mockFetch(claude('  Led a cloud migration.  '))
    const out = await chatComplete(
      [{ role: 'system', content: 'You are a helper.' }, ...ASK],
      { maxTokens: 80 },
    )
    expect(out.trim()).toBe('Led a cloud migration.')

    const [url, opts] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const headers = opts.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-xxx')
    expect(headers['anthropic-version']).toBeTruthy()
    // NOT Bearer
    expect(headers.Authorization).toBeUndefined()

    const body = JSON.parse(opts.body as string)
    expect(body.model).toBe('claude-haiku-4-5')
    expect(body.max_tokens).toBe(80)
    // Current Claude models reject temperature — it must be omitted.
    expect(body.temperature).toBeUndefined()
    // The system prompt is a top-level field, not a message role.
    expect(body.system).toBe('You are a helper.')
    expect(body.messages.some((m: { role: string }) => m.role === 'system')).toBe(false)
  })

  it('falls back to the anthropic default model when none is set', async () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    vi.stubEnv('LLM_ANTHROPIC_API_KEY', 'k')
    const fn = mockFetch(claude('Ok.'))
    await chatComplete(ASK, { maxTokens: 50 })
    const body = JSON.parse((fn.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.model).toBe('claude-haiku-4-5')
  })

  it('maps a 401 to a 502 key-rejected error', async () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')
    vi.stubEnv('LLM_OPENAI_API_KEY', 'bad')
    vi.stubEnv('LLM_MODEL', 'gpt-4o-mini')
    mockFetch({ ok: false, status: 401 })
    const err = await chatComplete(ASK, { maxTokens: 50 }).catch((e: unknown) => e)
    expect((err as LlmError).status).toBe(502)
    expect((err as LlmError).message).toMatch(/rejected the API key/i)
  })

  it('maps an Anthropic 401 the same way', async () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    vi.stubEnv('LLM_ANTHROPIC_API_KEY', 'bad')
    mockFetch({ ok: false, status: 401 })
    const err = await chatComplete(ASK, { maxTokens: 50 }).catch((e: unknown) => e)
    expect((err as LlmError).message).toMatch(/rejected the API key/i)
  })
})

describe('the language table — inherited keys', () => {
  // The locale reaches these off the request body (POST /api/translate), and
  // `LANGUAGES[locale]?.name` reads a FUNCTION for an inherited key: its
  // `.name` is a string, so the optional chain never fires and the fallback
  // never runs. languageNameOf answering non-null is the one that matters —
  // it is the guard translateLlm uses to REFUSE a locale it can't name.
  const INHERITED = ['toString', 'constructor', 'valueOf', 'hasOwnProperty']

  it('languageNameOf returns null so an unnamed locale is refused', () => {
    for (const key of INHERITED) expect(languageNameOf(key), key).toBeNull()
    expect(languageNameOf('no')).toContain('Norwegian')
  })

  it('languageName falls back instead of naming a function', () => {
    for (const key of INHERITED) {
      expect(languageName(key), key).toBe('the same language as the input')
    }
  })

  it('languageDirective is empty for an unknown locale', () => {
    for (const key of INHERITED) expect(languageDirective(key), key).toBe('')
    expect(languageDirective('no')).toContain('bokm')
  })
})
