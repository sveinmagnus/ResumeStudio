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

  it('skips a line that only announces the answer', () => {
    // Regression: taking the FIRST line put "Here is the summary:" in the CV
    // field and threw the summary away — which reads as a bad model, not a
    // parsing bug. Matched structurally (short line ending in a colon) because
    // the reply is in the user's language, not English.
    expect(tidyLine('Here is the summary:\n\nLed a cloud migration for a bank.'))
      .toBe('Led a cloud migration for a bank.')
    expect(tidyLine('Kort beskrivelse:\nLedet skymigrering for en bank.'))
      .toBe('Ledet skymigrering for en bank.')
  })

  it('caps the line at 240 characters', () => {
    // The field is a one-liner; a model that ignores that must not be able to
    // push a paragraph into it.
    expect(tidyLine('x'.repeat(500))).toHaveLength(240)
  })

  it('strips a NUMBERED list marker, both punctuation shapes', () => {
    expect(tidyLine('1. Led the team')).toBe('Led the team')
    expect(tidyLine('2) Led the team')).toBe('Led the team')
  })

  it('answers an empty or whitespace reply with an empty string, not a crash', () => {
    expect(tidyLine('')).toBe('')
    expect(tidyLine('   \n  \n')).toBe('')
  })

  it('treats a LONG line ending in a colon as content, not a preamble', () => {
    // The preamble heuristic is structural: short AND colon-terminated. A long
    // colon-terminated line is somebody's actual sentence.
    const long = 'A detailed account of the multi-year migration effort involving four teams:'
    expect(long.length).toBeGreaterThan(60)
    expect(tidyLine(long + '\nsecond line')).toBe(long)
  })

  it('keeps a line that merely CONTAINS a colon', () => {
    expect(tidyLine('Kubernetes: migrated 40 services onto it')).toBe('Kubernetes: migrated 40 services onto it')
  })

  it('falls back to the label when the reply is nothing else', () => {
    // Better to show the user something odd than to raise "no usable summary".
    expect(tidyLine('Summary:')).toBe('Summary:')
  })
})

/** Point the assist at a local model so summarize() has somewhere to call. */
function configure() {
  vi.stubEnv('LLM_PROVIDER', 'ollama')
  vi.stubEnv('LLM_OLLAMA_URL', 'http://localhost:11434')
  vi.stubEnv('LLM_MODEL', 'llama3.2')
}

describe('summarize()', () => {
  it('throws 503 when not configured', async () => {
    vi.stubEnv('LLM_PROVIDER', 'off')
    const err = await summarize('long text', 'en').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect((err as LlmError).status).toBe(503)
  })

  it('names the output language in the prompt and tidies the reply', async () => {
    configure()
    const fn = mockFetch(chat('  "Led a cloud migration for a bank."  '))
    const out = await summarize('A long description of the work…', 'no')
    expect(out).toBe('Led a cloud migration for a bank.')

    const body = JSON.parse((fn.mock.calls[0] as [string, RequestInit])[1].body as string)
    // Norwegian output requested in the system prompt — and spelled out as
    // Bokmål, which is what stops a small model answering in Swedish.
    expect(body.messages[0].content).toContain('Norwegian')
    // Plus the same instruction written IN Norwegian, which is the anchor an
    // all-English prompt lacks.
    expect(body.messages[0].content).toContain('Skriv hele svaret på norsk bokmål.')
    // Enough headroom that ~18 words of a non-English language can't be cut
    // mid-line, which is indistinguishable from a bad summary.
    expect(body.max_tokens).toBe(120)
  })

  it('tells the model what the heading already says, and not to restate it', async () => {
    // The reported failure: the drafted line just repeated the customer and the
    // job title, because nothing told the model those are already on screen.
    configure()
    const fn = mockFetch(chat('Rebuilt the order pipeline, cutting batch time to 40 minutes.'))
    await summarize('A long description…', 'en', ['Customer: Statoil', 'Project name: Order pipeline'])

    const body = JSON.parse((fn.mock.calls[0] as [string, RequestInit])[1].body as string)
    const system: string = body.messages[0].content
    const user: string = body.messages[1].content
    expect(system).toMatch(/ALREADY sees/)
    expect(system).toMatch(/never hedge|Never hedge/)
    expect(user).toContain('Customer: Statoil')
    expect(user).toContain('Project name: Order pipeline')
    expect(user).toMatch(/do NOT restate/i)
    // The source text is still what it summarizes.
    expect(user).toContain('A long description…')
  })

  it('works without context — an older client sends none', async () => {
    configure()
    const fn = mockFetch(chat('Led a cloud migration.'))
    expect(await summarize('Long text', 'en')).toBe('Led a cloud migration.')
    const user: string = JSON.parse((fn.mock.calls[0] as [string, RequestInit])[1].body as string).messages[1].content
    expect(user).not.toMatch(/do NOT restate/i)
  })

  it('bans hedging by name, since a hedge in a CV is worse than a short line', async () => {
    configure()
    const fn = mockFetch(chat('x'))
    await summarize('Long text', 'en')
    const system: string = JSON.parse((fn.mock.calls[0] as [string, RequestInit])[1].body as string).messages[0].content
    for (const hedge of ['might', 'possibly', 'appears to', 'various']) {
      expect(system, hedge).toContain(`"${hedge}"`)
    }
  })
})
