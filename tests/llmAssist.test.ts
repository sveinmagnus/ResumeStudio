import { describe, it, expect } from 'vitest'
import {
  paramsOf, inputBudget, estimateTokens, sizeHint, providerBlurb, isRemote, extractJson,
  supportsAdvanced, looksHighEnd, looksWeakForWriting, backendName,
} from '../src/lib/llmAssist'
import type { AssistStatus } from '../src/lib/api'

const local = (model: string): AssistStatus =>
  ({ configured: true, provider: 'ollama', model, local: true })
const remote = (model: string, provider = 'openai'): AssistStatus =>
  ({ configured: true, provider, model, local: false })
const off: AssistStatus = { configured: false, provider: '', model: '', local: false }

describe('paramsOf()', () => {
  it('reads the parameter count out of an Ollama tag', () => {
    expect(paramsOf('llama3.2:3b')).toBe(3)
    expect(paramsOf('qwen2.5:0.5b')).toBe(0.5)
    expect(paramsOf('phi3.5:3.8b')).toBe(3.8)
    expect(paramsOf('llama3.1:8b')).toBe(8)
  })

  it('handles sub-billion m tags', () => {
    expect(paramsOf('smollm2:360m')).toBeCloseTo(0.36)
  })

  it('is null for names with no size in them', () => {
    expect(paramsOf('gpt-4o-mini')).toBeNull()
    expect(paramsOf('my-org/custom:latest')).toBeNull()
    expect(paramsOf('')).toBeNull()
  })

  it('reads multi-digit and spaced sizes, and stops at the unit', () => {
    // A 70B tag is the difference between the small budget and the large one,
    // and a single-digit pattern would read it as 7 — or miss it entirely.
    expect(paramsOf('llama3.1:70b')).toBe(70)
    expect(paramsOf('qwen:110b')).toBe(110)
    // A mixture-of-experts tag has no separator before the per-expert size, so
    // it reads as unsized — which lands on the conservative budget, not a wrong
    // one.
    expect(paramsOf('mixtral:8x7b')).toBeNull()
    // Some tags space the unit off.
    expect(paramsOf('local-model:13 b')).toBe(13)
    expect(paramsOf('smollm2:1700m')).toBeCloseTo(1.7)
  })

  it('needs a separator before the size, so a version number is not a size', () => {
    // 'llama3b-tuned' has no separator; reading "3b" out of a name like this
    // would size a model from its version string.
    expect(paramsOf('llama3.2')).toBeNull()
    expect(paramsOf('bert')).toBeNull()
  })

  it('reads only a size that ends at a word boundary', () => {
    // ':3bx' is not three billion parameters.
    expect(paramsOf('weird:3bx')).toBeNull()
  })
})

describe('inputBudget()', () => {
  it('gives small local models a small budget', () => {
    expect(inputBudget(local('llama3.2:3b'))).toBeLessThan(inputBudget(local('llama3.1:8b')))
  })

  it('assumes an unsized LOCAL model is small, and an unsized REMOTE one is large', () => {
    // The failure being guarded against (garbled output from an overloaded 3B)
    // is the local one; hosted endpoints are chosen for their big context.
    expect(inputBudget(local('custom:latest'))).toBeLessThan(inputBudget(remote('gpt-4o-mini')))
  })

  it('bands the budget at 4B and 15B, inclusive at each edge', () => {
    // Three bands, two edges, and both were only ever approached from one side
    // — so either could move several billion parameters without a test moving.
    const small = inputBudget(local('m:3b'))
    const medium = inputBudget(local('m:8b'))
    const large = inputBudget(local('m:70b'))
    expect(small).toBeLessThan(medium)
    expect(medium).toBeLessThan(large)

    expect(inputBudget(local('m:4b'))).toBe(small)     // 4 is still small
    expect(inputBudget(local('m:5b'))).toBe(medium)
    expect(inputBudget(local('m:15b'))).toBe(medium)   // 15 is still medium
    expect(inputBudget(local('m:16b'))).toBe(large)
  })

  it('gives a declared high-end model the large budget whatever its name says', () => {
    // The declaration outranks the name — that is the whole point of the flag,
    // since a hosted name parses to no size at all.
    const declared = { ...local('m:3b'), highEnd: true }
    expect(inputBudget(declared)).toBe(inputBudget(local('m:70b')))
  })
})

describe('supportsAdvanced()', () => {
  /**
   * THE client-side gate on every advanced assist (§15), and it had no test at
   * all. Both halves matter: an unconfigured backend cannot run them, and a
   * configured-but-not-declared one must not — a small model does not refuse a
   * whole-CV review, it answers fluently and wrongly.
   */
  it('needs the endpoint configured AND declared high-end', () => {
    const base = local('m:3b')
    expect(supportsAdvanced({ ...base, configured: true, highEnd: true })).toBe(true)
    expect(supportsAdvanced({ ...base, configured: true, highEnd: false })).toBe(false)
    expect(supportsAdvanced({ ...base, configured: false, highEnd: true })).toBe(false)
    expect(supportsAdvanced({ ...base, configured: false, highEnd: false })).toBe(false)
  })
})

describe('looksHighEnd()', () => {
  /**
   * The SUGGESTION behind the §15 checkbox — a twelve-entry regex list that had
   * no test at all, so any of those patterns could have been wrong (or gone)
   * without a failure. Being wrong here is quiet: it pre-ticks a box the user
   * then accepts, and a 3B model answers a whole-CV review fluently and wrongly.
   */
  it('recognises a frontier family by name', () => {
    for (const m of [
      'claude-opus-5', 'claude-sonnet-5', 'gpt-5', 'gpt-4.1', 'gpt-4o',
      'o3', 'gemini-2.5-pro', 'mistral-large-latest', 'deepseek-r1',
      'deepseek-v3', 'qwen2.5-max', 'grok-4', 'llama-3.1-405b',
    ]) {
      expect(looksHighEnd(m), m).toBe(true)
    }
  })

  it('is not fooled by the small member of a frontier family', () => {
    // The lookahead on gpt-4o exists for exactly this: -mini is the cheap one.
    expect(looksHighEnd('gpt-4o-mini')).toBe(false)
    expect(looksHighEnd('claude-haiku-4-5')).toBe(false)
    expect(looksHighEnd('gemini-2.5-flash')).toBe(false)
    expect(looksHighEnd('gpt-3.5-turbo')).toBe(false)
  })

  it('accepts a local model at or above the parameter threshold, not below', () => {
    expect(looksHighEnd('qwen2.5:27b')).toBe(true)   // 27 is the edge, inclusive
    expect(looksHighEnd('llama3.1:70b')).toBe(true)
    expect(looksHighEnd('mixtral:26b')).toBe(false)
    expect(looksHighEnd('llama3.2:3b')).toBe(false)
  })

  it('leaves an unrecognised or empty name unticked — the user decides', () => {
    expect(looksHighEnd('my-org/custom:latest')).toBe(false)
    expect(looksHighEnd('')).toBe(false)
    expect(looksHighEnd('   ')).toBe(false)
  })
})

describe('looksWeakForWriting()', () => {
  it('flags a small local model, and stops at 8B', () => {
    expect(looksWeakForWriting(local('llama3.2:3b'))).toBe(true)
    expect(looksWeakForWriting(local('m:8b'))).toBe(true)   // 8 is still weak
    expect(looksWeakForWriting(local('m:9b'))).toBe(false)
  })

  it('assumes an unsized LOCAL model is weak but an unsized REMOTE one is not', () => {
    expect(looksWeakForWriting(local('custom:latest'))).toBe(true)
    expect(looksWeakForWriting(remote('gpt-4o-mini'))).toBe(false)
  })

  it('never flags a declared high-end model, whatever its name parses to', () => {
    expect(looksWeakForWriting({ ...local('m:3b'), highEnd: true })).toBe(false)
  })

  it('says nothing when nothing is configured', () => {
    // No model means the manual path, which this warning does not apply to.
    expect(looksWeakForWriting(off)).toBe(false)
  })
})

describe('sizeHint()', () => {
  it('is silent for a prompt that fits', () => {
    expect(sizeHint(500, local('llama3.2:3b'))).toBeNull()
  })

  it('warns when a small local model would be overloaded', () => {
    const hint = sizeHint(200_000, local('llama3.2:3b'))
    expect(hint).toContain('llama3.2:3b')
    expect(hint).toMatch(/truncate or garble/i)
  })

  it('lets the same prompt through on a hosted model', () => {
    expect(sizeHint(60_000, remote('gpt-4o-mini'))).toBeNull()
  })

  it('says nothing when no model is configured (the manual path has no limit)', () => {
    expect(sizeHint(999_999, off)).toBeNull()
  })
})

describe('providerBlurb()', () => {
  it('promises locality ONLY for a local endpoint', () => {
    expect(providerBlurb(local('llama3.2:3b'), true)).toMatch(/does not leave/i)
  })

  it('names the destination for a remote endpoint, and never claims locality', () => {
    const b = providerBlurb(remote('gpt-4o-mini', 'openai'), true)
    expect(b).toMatch(/over the internet/i)
    expect(b).toContain('openai')
    expect(b).not.toMatch(/does not leave/i)
  })

  it('points at the manual path when nothing is configured and one exists', () => {
    const b = providerBlurb(off, true)
    expect(b).toMatch(/manual/i)
    expect(b).toMatch(/Settings → AI assist/)
  })

  it('offers only Settings when the caller has no manual path', () => {
    // The in-editor panels (key points, writing coach, skill suggest) render no
    // copy-prompt steps — naming "the manual path" there points at nothing.
    const b = providerBlurb(off, false)
    expect(b).not.toMatch(/manual/i)
    expect(b).toMatch(/Settings → AI assist/)
  })

  it('says a model is unconfigured either way', () => {
    for (const hasManual of [true, false]) {
      expect(providerBlurb(off, hasManual)).toMatch(/no ai model is configured/i)
    }
  })
})

describe('isRemote()', () => {
  it('is true only for a configured, non-local backend', () => {
    expect(isRemote(remote('gpt-4o-mini'))).toBe(true)
    expect(isRemote(local('llama3.2:3b'))).toBe(false)
    // Nothing configured sends nothing anywhere — no confirm to show.
    expect(isRemote(off)).toBe(false)
  })
})

describe('estimateTokens()', () => {
  it('scales with length', () => {
    expect(estimateTokens(3500)).toBe(1000)
    expect(estimateTokens(0)).toBe(0)
  })
})

describe('extractJson()', () => {
  const obj = '{"$schema":"resumestudio-tailor/v1","sections":[]}'

  it('passes clean JSON straight through', () => {
    expect(extractJson(obj)).toBe(obj)
    expect(extractJson(`  ${obj}  `)).toBe(obj)
  })

  it('unwraps a ```json fence', () => {
    expect(extractJson('```json\n' + obj + '\n```')).toBe(obj)
  })

  it('unwraps a bare ``` fence', () => {
    expect(extractJson('```\n' + obj + '\n```')).toBe(obj)
  })

  it('drops a chatty preamble and sign-off', () => {
    // What a small local model actually does, however firmly you ask it not to.
    expect(extractJson(`Sure! Here's the JSON:\n${obj}\nLet me know if you need changes.`)).toBe(obj)
  })

  it('handles a fenced reply WITH a preamble', () => {
    expect(extractJson('Here you go:\n```json\n' + obj + '\n```\nHope that helps!')).toBe(obj)
  })

  it('handles a top-level array', () => {
    expect(extractJson('```json\n[1,2]\n```')).toBe('[1,2]')
  })

  it('leaves junk alone so the caller reports its own parse error', () => {
    // No JSON to find → don't invent one; the user should see "not valid JSON".
    expect(extractJson('I cannot help with that.')).toBe('I cannot help with that.')
    expect(extractJson('')).toBe('')
  })

  it('keeps nested braces intact (outermost object wins)', () => {
    const nested = '{"a":{"b":[{"c":1}]}}'
    expect(extractJson(`text ${nested} more`)).toBe(nested)
  })
})

describe('extractJson — finding the JSON in a fluent reply', () => {
  it('returns clean JSON untouched', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}')
    expect(extractJson('  [1,2]  ')).toBe('[1,2]')
  })

  it('unwraps a fenced block, tagged or bare, however the newline is written', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJson('```JSON\r\n{"a":1}\r\n```')).toBe('{"a":1}')
    // No newline at all after the fence, and no space either.
    expect(extractJson('```{"a":1}```')).toBe('{"a":1}')
    expect(extractJson('```json {"a":1}```')).toBe('{"a":1}')
  })

  it('takes the FIRST fenced block when the model wrote two', () => {
    expect(extractJson('```\n{"a":1}\n```\nand also\n```\n{"b":2}\n```')).toBe('{"a":1}')
  })

  it('trims prose either side of an unfenced object or array', () => {
    expect(extractJson('Here is the answer: {"a":1} — hope that helps!')).toBe('{"a":1}')
    expect(extractJson('Sure!\n[1,2]\nLet me know.')).toBe('[1,2]')
  })

  it('takes the OUTERMOST braces, so a nested object survives intact', () => {
    expect(extractJson('text {"a":{"b":1}} text')).toBe('{"a":{"b":1}}')
  })

  it('leaves a reply with no JSON in it unchanged, so the parse error stays the user\u2019s', () => {
    expect(extractJson('I cannot help with that.')).toBe('I cannot help with that.')
    expect(extractJson('  ')).toBe('')
  })

  it('does not mistake a CLOSING brace before the opening one for a payload', () => {
    // "} … {" must not slice backwards into an empty or reversed string.
    expect(extractJson('} then {')).toBe('} then {')
  })

  it('keeps a single-character payload', () => {
    expect(extractJson('```\n{}\n```')).toBe('{}')
  })
})

describe('backendName — naming the destination once', () => {
  const status = (provider: string, model: string): AssistStatus => ({
    configured: true, local: false, provider, model, highEnd: false,
  })

  it('prints both when the model id does not already say who it is', () => {
    expect(backendName(status('openai', 'o3-mini'))).toBe('openai, o3-mini')
  })

  it('prints the model alone when it already contains the provider name', () => {
    // "gemini, gemini-3.6-flash" said the same word twice.
    expect(backendName(status('gemini', 'gemini-3.6-flash'))).toBe('gemini-3.6-flash')
  })

  it('matches the provider name case-insensitively', () => {
    expect(backendName(status('Gemini', 'gemini-3.6-flash'))).toBe('gemini-3.6-flash')
    expect(backendName(status('openai', 'OpenAI-GPT'))).toBe('OpenAI-GPT')
  })

  it('falls back to whichever half it has', () => {
    expect(backendName(status('ollama', ''))).toBe('ollama')
    expect(backendName(status('ollama', '   '))).toBe('ollama')
    expect(backendName(status('', 'llama3'))).toBe('llama3')
    expect(backendName(status('   ', 'llama3'))).toBe('llama3')
  })

  it('trims both halves rather than printing the padding', () => {
    expect(backendName(status('  openai  ', '  o3-mini  '))).toBe('openai, o3-mini')
  })
})

describe('looksHighEnd — the suggestion, never the decision', () => {
  it('ignores surrounding whitespace on the model id', () => {
    expect(looksHighEnd('  claude-opus-4-5  ')).toBe(true)
    expect(looksHighEnd('   ')).toBe(false)
    expect(looksHighEnd('')).toBe(false)
  })

  it('recognises the 405B llama with or without the separators', () => {
    expect(looksHighEnd('llama-3.1-405b')).toBe(true)
    expect(looksHighEnd('llama3-405b')).toBe(true)
    expect(looksHighEnd('llama405b')).toBe(true)
    expect(looksHighEnd('llama-3.1-8b')).toBe(false)
  })

  it('uses the parsed size when there is one, and the name when there is not', () => {
    expect(looksHighEnd('qwen2.5:32b')).toBe(true)
    expect(looksHighEnd('qwen2.5:14b')).toBe(false)
    expect(looksHighEnd('some-unknown-model')).toBe(false)
  })
})

describe('paramsOf — decimal sizes', () => {
  it('reads a multi-digit decimal, not just one place', () => {
    expect(paramsOf('model:1.25b')).toBeCloseTo(1.25, 3)
    expect(paramsOf('model:0.5b')).toBeCloseTo(0.5, 3)
    expect(paramsOf('model:270.75m')).toBeCloseTo(0.27075, 5)
  })
})

describe('sizeHint fires just PAST the budget, not at it', () => {
  it('stays silent at exactly the budget and speaks one token later', () => {
    // "Warn at exactly the limit" would nag on a prompt that fits, which is the
    // difference between an informative hint and one people learn to ignore.
    const status = local('llama3:3b')
    const budget = inputBudget(status)
    // Largest char count that still estimates to exactly `budget` tokens.
    const atBudget = budget * 3.5
    expect(estimateTokens(atBudget)).toBe(budget)
    expect(sizeHint(atBudget, status)).toBeNull()

    const overBudget = atBudget + 1
    expect(estimateTokens(overBudget)).toBe(budget + 1)
    expect(sizeHint(overBudget, status)).toMatch(/long/)
  })
})
