import { describe, it, expect, vi, afterEach } from 'vitest'
import { LlmError } from '../../server/llm'
import { summarize, tidyLine } from '../../server/summarize'

/**
 * The Summarize FEATURE. The provider matrix, wire protocols and error mapping
 * live in llm.test.ts — what's tested here is the one thing this module adds:
 * a prompt in the right language, and a tidy single line out.
 */

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

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

describe('summarize()', () => {
  it('throws 503 when not configured', async () => {
    vi.stubEnv('LLM_PROVIDER', 'off')
    const err = await summarize('long text', 'en').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect((err as LlmError).status).toBe(503)
  })

  it('names the output language in the prompt and tidies the reply', async () => {
    vi.stubEnv('LLM_PROVIDER', 'ollama')
    vi.stubEnv('LLM_OLLAMA_URL', 'http://localhost:11434')
    vi.stubEnv('LLM_MODEL', 'llama3.2')
    const fn = mockFetch(chat('  "Led a cloud migration for a bank."  '))
    const out = await summarize('A long description of the work…', 'no')
    expect(out).toBe('Led a cloud migration for a bank.')

    const body = JSON.parse((fn.mock.calls[0] as [string, RequestInit])[1].body as string)
    // Norwegian output requested in the system prompt — and spelled out as
    // Bokmål, which is what stops a small model answering in Swedish.
    expect(body.messages[0].content).toContain('Norwegian')
    expect(body.max_tokens).toBe(80)
  })
})
