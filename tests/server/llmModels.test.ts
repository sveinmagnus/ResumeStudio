import { describe, it, expect, vi, afterEach } from 'vitest'
import { listProviderModels } from '../../server/llmModels'
import type { LlmConfig } from '../../server/llm'

afterEach(() => { vi.unstubAllGlobals() })

function cfg(over: Partial<LlmConfig> = {}): LlmConfig {
  return {
    provider: 'off',
    ollama: { url: '' }, openai: { apiKey: '' }, compat: { url: '', apiKey: '' },
    anthropic: { apiKey: '' }, gemini: { apiKey: '' }, mistral: { apiKey: '' },
    model: '', highEnd: false, ...over,
  }
}

function mockJson(body: unknown, ok = true) {
  const fn = vi.fn().mockResolvedValue({ ok, json: async () => body })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('listProviderModels()', () => {
  it('reads the OpenAI list shape and sends the key', async () => {
    const fn = mockJson({ data: [{ id: 'gpt-5' }, { id: 'gpt-4o-mini' }] })
    const models = await listProviderModels(cfg({ provider: 'openai', openai: { apiKey: 'sk-x' } }))
    expect(models.map((m) => m.id)).toContain('gpt-5')

    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/models')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-x')
  })

  /**
   * Gemini's OpenAI-compatible endpoint returns ids as "models/gemini-…" but
   * the chat endpoint wants them bare — get this wrong and every listed model
   * 404s on first use, which is the bug this whole feature is fixing.
   */
  it('strips the "models/" prefix Gemini returns', async () => {
    mockJson({ data: [{ id: 'models/gemini-flash-latest' }] })
    const models = await listProviderModels(cfg({ provider: 'gemini', gemini: { apiKey: 'g' } }))
    expect(models.map((m) => m.id)).toEqual(['gemini-flash-latest'])
  })

  it('uses Anthropic\'s own headers and keeps its display names', async () => {
    const fn = mockJson({ data: [{ id: 'claude-opus-4-5', display_name: 'Claude Opus 4.5' }] })
    const models = await listProviderModels(cfg({ provider: 'anthropic', anthropic: { apiKey: 'k' } }))
    expect(models[0]).toEqual({ id: 'claude-opus-4-5', label: 'Claude Opus 4.5' })

    const headers = (fn.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers['x-api-key']).toBe('k')
    expect(headers['anthropic-version']).toBeTruthy()
    expect(headers.Authorization).toBeUndefined()
  })

  /** Chat is all this app does; embeddings and audio are noise in a picker. */
  it('filters out models that cannot chat', async () => {
    mockJson({ data: [
      { id: 'gpt-5' }, { id: 'text-embedding-3-large' }, { id: 'whisper-1' },
      { id: 'dall-e-3' }, { id: 'omni-moderation-latest' },
    ] })
    const models = await listProviderModels(cfg({ provider: 'openai', openai: { apiKey: 'k' } }))
    expect(models.map((m) => m.id)).toEqual(['gpt-5'])
  })

  /**
   * Providers return their lists in no useful order. Alphabetical would bury
   * gemini-3.6 under gemini-1.5, which is the wrong way round for a picker.
   */
  it('puts the newest-looking version first', async () => {
    mockJson({ data: [
      { id: 'gemini-1.5-flash' }, { id: 'gemini-3.6-flash' }, { id: 'gemini-2.5-flash' },
    ] })
    const models = await listProviderModels(cfg({ provider: 'gemini', gemini: { apiKey: 'g' } }))
    expect(models[0].id).toBe('gemini-3.6-flash')
  })

  it('never throws — an unreachable or unhappy provider is an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await listProviderModels(cfg({ provider: 'openai', openai: { apiKey: 'k' } }))).toEqual([])

    mockJson({ error: 'nope' }, false)
    expect(await listProviderModels(cfg({ provider: 'openai', openai: { apiKey: 'k' } }))).toEqual([])

    mockJson({ unexpected: 'shape' })
    expect(await listProviderModels(cfg({ provider: 'openai', openai: { apiKey: 'k' } }))).toEqual([])
  })

  it('returns nothing when the provider is off or unconfigured', async () => {
    const fn = vi.fn()
    vi.stubGlobal('fetch', fn)
    expect(await listProviderModels(cfg({ provider: 'off' }))).toEqual([])
    // No key
    expect(await listProviderModels(cfg({ provider: 'openai' }))).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  it('asks Ollama what it has pulled, not what it could run', async () => {
    const fn = mockJson({ models: [{ name: 'llama3.2:3b', size: 2_000_000_000 }] })
    const models = await listProviderModels(
      cfg({ provider: 'ollama', ollama: { url: 'http://localhost:11434' }, model: 'x' }),
    )
    expect(models.map((m) => m.id)).toEqual(['llama3.2:3b'])
    expect((fn.mock.calls[0] as [string])[0]).toBe('http://localhost:11434/api/tags')
  })
})
