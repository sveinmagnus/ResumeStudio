/**
 * Replies from a REASONING model — one that thinks out loud before answering.
 *
 * Reported against a production install running Google's `gemma-4-31b-it`:
 * every assist failed with "JSON.parse: unexpected character at line 1 column
 * 1", or appeared to hang and then error. Both symptoms came from the same
 * shape of reply, reproduced here from real captures:
 *
 *  - the model emits `<thought>…</thought>` first, and that prose is full of
 *    brackets, so the old "slice from the first bracket to the last" heuristic
 *    sliced a sentence out of the DELIBERATION and handed it to JSON.parse;
 *  - given too small a reply budget it spends the whole thing thinking and
 *    never answers at all — the server returned that as if it were an answer.
 *
 * Both boundaries where a model reply enters the app have to handle it, so the
 * two strippers are cross-checked here rather than left to drift (the
 * arrangement `server/skillKey.ts` uses).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  extractJson, stripReasoning as stripClient, REASONING_TAGS as CLIENT_TAGS,
} from '../src/lib/llmAssist'
import {
  stripReasoning as stripServer, REASONING_TAGS as SERVER_TAGS, chatComplete, LlmError,
  type LlmConfig,
} from '../server/llm'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

function cfg(over: Partial<LlmConfig> = {}): LlmConfig {
  return {
    provider: 'gemini', ollama: { url: '' }, openai: { apiKey: '' },
    compat: { url: '', apiKey: '' }, anthropic: { apiKey: '' },
    gemini: { apiKey: 'k' }, mistral: { apiKey: '' },
    model: 'gemma-4-31b-it', highEnd: true, ...over,
  }
}

function mockChat(content: string | null, finish_reason = 'stop') {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content }, finish_reason }] }),
  }))
}

const ASK = [{ role: 'user' as const, content: 'text' }]

/**
 * A verbatim-shaped capture: the deliberation is full of square brackets, which
 * is precisely what poisoned the old extractor.
 */
const THOUGHT = `<thought>*   Role: Consultant helping tighten a CV description.
    *   The sentence is: [Accredited part-time study] in [Project management] for [Telenor employees].
    *   Wait, if the heading already says that, it is redundant.
</thought>`

describe('the two strippers agree', () => {
  it('recognises the same reasoning wrappers on the client and the server', () => {
    expect([...CLIENT_TAGS].sort()).toEqual([...SERVER_TAGS].sort())
  })

  it('strips identically', () => {
    const samples = [
      `${THOUGHT}\n{"a":1}`,
      '<think>pondering</think>answer',
      '<thought>cut off mid-sentence and never closed',
      'no reasoning at all',
      '',
    ]
    for (const s of samples) expect(stripClient(s), s.slice(0, 30)).toBe(stripServer(s))
  })
})

describe('stripReasoning', () => {
  it('removes a closed block and keeps the answer', () => {
    expect(stripClient(`${THOUGHT}\n{"rewrite":"x"}`)).toBe('{"rewrite":"x"}')
  })

  it('removes an UNCLOSED block — a reply cut off while still thinking', () => {
    // There is no answer after it by definition; leaving the fragment in would
    // present deliberation as the model's response.
    expect(stripClient('<thought>still weighing it up, and then the budget ran')).toBe('')
  })

  it('handles every tag, in any case, with attributes', () => {
    for (const tag of CLIENT_TAGS) {
      expect(stripClient(`<${tag}>x</${tag}>answer`)).toBe('answer')
      expect(stripClient(`<${tag.toUpperCase()}>x</${tag.toUpperCase()}>answer`)).toBe('answer')
    }
    expect(stripClient('<thought type="x">x</thought>answer')).toBe('answer')
  })

  it('leaves an ordinary reply alone', () => {
    expect(stripClient('{"rewrite":"I thought about it"}')).toBe('{"rewrite":"I thought about it"}')
  })
})

describe('extractJson with a reasoning preamble', () => {
  it('finds the payload past deliberation full of brackets (the reported bug)', () => {
    const reply = `${THOUGHT}\n\`\`\`json\n{"$schema":"resumestudio-rewrite/v1","rewrite":"Completed the study.","asks":[]}\n\`\`\``
    const parsed = JSON.parse(extractJson(reply)) as { rewrite: string }
    expect(parsed.rewrite).toBe('Completed the study.')
  })

  it('finds unfenced JSON after a thought block', () => {
    expect(JSON.parse(extractJson(`${THOUGHT}\n{"points":[{"body":"x"}]}`))).toEqual({ points: [{ body: 'x' }] })
  })

  it('ignores a bracketed phrase in prose and takes the real payload', () => {
    // The old slice ran from the first "[" to the last "}" and could never parse.
    const reply = 'I considered [option A] and [option B]. Here is the JSON:\n{"rewrite":"x","asks":[]}'
    expect(JSON.parse(extractJson(reply))).toEqual({ rewrite: 'x', asks: [] })
  })

  it('is not fooled by a brace inside a string value', () => {
    const reply = 'prose {"rewrite":"a } brace and a ] bracket","asks":[]} trailing'
    expect(JSON.parse(extractJson(reply))).toEqual({ rewrite: 'a } brace and a ] bracket', asks: [] })
  })

  it('still handles the plain cases it always did', () => {
    expect(JSON.parse(extractJson('{"a":1}'))).toEqual({ a: 1 })
    expect(JSON.parse(extractJson('```json\n{"a":1}\n```'))).toEqual({ a: 1 })
    expect(JSON.parse(extractJson('Here you go:\n```\n[1,2]\n```'))).toEqual([1, 2])
  })

  it('hands back the cleaned reply when there is no JSON, so the caller errors on what it saw', () => {
    expect(extractJson(`${THOUGHT}\nI cannot help with that.`)).toBe('I cannot help with that.')
  })
})

describe('a reply that is reasoning only', () => {
  it('is an error naming the budget, not text the caller has to parse', async () => {
    // The exact production failure: the whole budget went on thinking, so
    // `content` is long and the ANSWER is empty. Returning it produced a
    // JSON.parse error three layers from the cause.
    mockChat('<thought>thinking and thinking and then the budget ran out', 'length')
    await expect(chatComplete(ASK, { maxTokens: 900 }, cfg()))
      .rejects.toThrow(/whole reply budget on internal reasoning/i)
  })

  it('says so differently when the model simply stopped without answering', async () => {
    mockChat('<thought>done deliberating</thought>', 'stop')
    await expect(chatComplete(ASK, { maxTokens: 900 }, cfg()))
      .rejects.toThrow(/reasoning only/i)
  })

  it('reports an empty reply that was truncated as a limit problem', async () => {
    mockChat('', 'length')
    await expect(chatComplete(ASK, { maxTokens: 900 }, cfg()))
      .rejects.toThrow(/hit its reply limit/i)
  })

  it('still reports a plain empty reply as no text', async () => {
    mockChat('', 'stop')
    await expect(chatComplete(ASK, { maxTokens: 900 }, cfg())).rejects.toThrow(/returned no text/i)
  })

  it('is an LlmError, so the route maps it to a status rather than a 500', async () => {
    mockChat('<thought>x', 'length')
    await expect(chatComplete(ASK, { maxTokens: 900 }, cfg())).rejects.toBeInstanceOf(LlmError)
  })
})

describe('a normal reply from a reasoning model', () => {
  it('reaches the caller with the thinking removed', async () => {
    // summarize.ts takes the FIRST LINE of the reply — without this it would
    // write "<thought>*  Role: …" into a CV field.
    mockChat(`${THOUGHT}\nCompleted the accredited study.`)
    expect(await chatComplete(ASK, { maxTokens: 900 }, cfg())).toBe('Completed the accredited study.')
  })

  it('leaves a reply from a non-reasoning model untouched', async () => {
    mockChat('Just the answer.')
    expect(await chatComplete(ASK, { maxTokens: 900 }, cfg())).toBe('Just the answer.')
  })

  it('applies the same rule to the Anthropic wire path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: `${THOUGHT}\nAnswer.` }], stop_reason: 'end_turn' }),
    }))
    const c = cfg({ provider: 'anthropic', anthropic: { apiKey: 'k' }, model: 'claude-haiku-4-5' })
    expect(await chatComplete(ASK, { maxTokens: 900 }, c)).toBe('Answer.')
  })

  it("treats Anthropic's max_tokens stop reason as truncation too", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '<thought>still going' }], stop_reason: 'max_tokens' }),
    }))
    const c = cfg({ provider: 'anthropic', anthropic: { apiKey: 'k' }, model: 'claude-haiku-4-5' })
    await expect(chatComplete(ASK, { maxTokens: 900 }, c)).rejects.toThrow(/whole reply budget/i)
  })
})
