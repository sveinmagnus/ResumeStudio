import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  toServiceLocale,
  isTranslationConfigured,
  translate,
  ltLoadOnly,
  TranslateError,
} from '../../server/translate'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('toServiceLocale()', () => {
  it('maps the app codes that differ from ISO 639-1', () => {
    expect(toServiceLocale('no')).toBe('nb')
    expect(toServiceLocale('se')).toBe('sv')
    expect(toServiceLocale('dk')).toBe('da')
  })
  it('passes through matching codes and lower-cases unknowns', () => {
    expect(toServiceLocale('en')).toBe('en')
    expect(toServiceLocale('PT')).toBe('pt')
  })
})

describe('isTranslationConfigured()', () => {
  it('reflects LIBRETRANSLATE_URL presence', () => {
    vi.stubEnv('LIBRETRANSLATE_URL', '')
    expect(isTranslationConfigured()).toBe(false)
    vi.stubEnv('LIBRETRANSLATE_URL', 'http://lt:5000')
    expect(isTranslationConfigured()).toBe(true)
  })
})

/** Build a fetch mock that resolves to a Response-ish object. */
function mockFetch(resp: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fn = vi.fn().mockResolvedValue(resp)
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('translate()', () => {
  it('throws 503 when no backend is configured', async () => {
    vi.stubEnv('LIBRETRANSLATE_URL', '')
    const err = await translate('hi', 'en', 'no').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TranslateError)
    expect((err as TranslateError).status).toBe(503)
  })

  it('maps locales, strips a trailing slash, and returns the translated text', async () => {
    vi.stubEnv('LIBRETRANSLATE_URL', 'http://lt:5000/')
    vi.stubEnv('LIBRETRANSLATE_API_KEY', 'secret')
    const fn = mockFetch({ ok: true, json: async () => ({ translatedText: 'Hei verden' }) })

    const out = await translate('Hello world', 'en', 'no')
    expect(out).toBe('Hei verden')

    const [url, opts] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://lt:5000/translate')
    const body = JSON.parse(opts.body as string)
    expect(body).toMatchObject({ q: 'Hello world', source: 'en', target: 'nb', api_key: 'secret' })
  })

  it('omits api_key when none is configured', async () => {
    vi.stubEnv('LIBRETRANSLATE_URL', 'http://lt:5000')
    vi.stubEnv('LIBRETRANSLATE_API_KEY', '')
    const fn = mockFetch({ ok: true, json: async () => ({ translatedText: 'x' }) })
    await translate('a', 'en', 'se')
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.api_key).toBeUndefined()
    expect(body.target).toBe('sv')
  })

  it('maps a 400 from the backend to "unavailable language pair"', async () => {
    vi.stubEnv('LIBRETRANSLATE_URL', 'http://lt:5000')
    mockFetch({ ok: false, status: 400 })
    const err = await translate('a', 'en', 'no').catch((e: unknown) => e)
    expect((err as TranslateError).status).toBe(400)
  })

  it('maps other non-OK responses to 502', async () => {
    vi.stubEnv('LIBRETRANSLATE_URL', 'http://lt:5000')
    mockFetch({ ok: false, status: 500 })
    const err = await translate('a', 'en', 'no').catch((e: unknown) => e)
    expect((err as TranslateError).status).toBe(502)
  })

  it('maps a network failure to 502 without leaking details', async () => {
    vi.stubEnv('LIBRETRANSLATE_URL', 'http://lt:5000')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED http://internal:5000')))
    const err = await translate('a', 'en', 'no').catch((e: unknown) => e)
    expect((err as TranslateError).status).toBe(502)
    expect((err as TranslateError).message).not.toContain('internal')
  })

  it('maps a missing translatedText field to 502', async () => {
    vi.stubEnv('LIBRETRANSLATE_URL', 'http://lt:5000')
    mockFetch({ ok: true, json: async () => ({ nope: true }) })
    const err = await translate('a', 'en', 'no').catch((e: unknown) => e)
    expect((err as TranslateError).status).toBe(502)
  })
})

describe('provider selection (TRANSLATE_PROVIDER)', () => {
  it('back-compat: a bare LIBRETRANSLATE_URL implies the libretranslate provider', () => {
    vi.stubEnv('LIBRETRANSLATE_URL', 'http://lt:5000')
    expect(isTranslationConfigured()).toBe(true)
  })
  it('off when nothing is configured', () => {
    vi.stubEnv('LIBRETRANSLATE_URL', '')
    vi.stubEnv('TRANSLATE_PROVIDER', '')
    expect(isTranslationConfigured()).toBe(false)
  })
  it('deepl is configured only with a key', () => {
    vi.stubEnv('TRANSLATE_PROVIDER', 'deepl')
    vi.stubEnv('DEEPL_API_KEY', '')
    expect(isTranslationConfigured()).toBe(false)
    vi.stubEnv('DEEPL_API_KEY', 'abc')
    expect(isTranslationConfigured()).toBe(true)
  })
})

describe('translate() — DeepL', () => {
  it('uses the Free host for a :fx key, DeepL auth header, and uppercased langs', async () => {
    vi.stubEnv('TRANSLATE_PROVIDER', 'deepl')
    vi.stubEnv('DEEPL_API_KEY', 'secret:fx')
    const fn = mockFetch({ ok: true, json: async () => ({ translations: [{ text: 'Hei' }] }) })
    const out = await translate('Hello', 'en', 'no')
    expect(out).toBe('Hei')
    const [url, opts] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api-free.deepl.com/v2/translate')
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('DeepL-Auth-Key secret:fx')
    const body = JSON.parse(opts.body as string)
    expect(body).toMatchObject({ text: ['Hello'], source_lang: 'EN', target_lang: 'NB' })
  })

  it('uses the Pro host for a non-:fx key and EN-GB for an English target', async () => {
    vi.stubEnv('TRANSLATE_PROVIDER', 'deepl')
    vi.stubEnv('DEEPL_API_KEY', 'prokey')
    const fn = mockFetch({ ok: true, json: async () => ({ translations: [{ text: 'Hello' }] }) })
    await translate('Hei', 'no', 'en')
    const [url, opts] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.deepl.com/v2/translate')
    expect(JSON.parse(opts.body as string).target_lang).toBe('EN-GB')
  })

  it('maps a 403 to a key-rejected 502', async () => {
    vi.stubEnv('TRANSLATE_PROVIDER', 'deepl')
    vi.stubEnv('DEEPL_API_KEY', 'bad')
    mockFetch({ ok: false, status: 403 })
    const err = await translate('a', 'en', 'no').catch((e: unknown) => e)
    expect((err as TranslateError).status).toBe(502)
    expect((err as TranslateError).message).toMatch(/key/i)
  })
})

describe('translate() — Google', () => {
  it('passes the key in the query and returns translatedText', async () => {
    vi.stubEnv('TRANSLATE_PROVIDER', 'google')
    vi.stubEnv('GOOGLE_TRANSLATE_API_KEY', 'gkey')
    const fn = mockFetch({ ok: true, json: async () => ({ data: { translations: [{ translatedText: 'Hei' }] } }) })
    const out = await translate('Hello', 'en', 'no')
    expect(out).toBe('Hei')
    const [url, opts] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('translation.googleapis.com')
    expect(url).toContain('key=gkey')
    const body = JSON.parse(opts.body as string)
    expect(body).toMatchObject({ q: 'Hello', source: 'en', target: 'no', format: 'text' })
  })
})

describe('translate() — Azure', () => {
  it('sends the key + region headers and from/to query params', async () => {
    vi.stubEnv('TRANSLATE_PROVIDER', 'azure')
    vi.stubEnv('AZURE_TRANSLATOR_KEY', 'akey')
    vi.stubEnv('AZURE_TRANSLATOR_REGION', 'westeurope')
    const fn = mockFetch({ ok: true, json: async () => ([{ translations: [{ text: 'Hei' }] }]) })
    const out = await translate('Hello', 'en', 'no')
    expect(out).toBe('Hei')
    const [url, opts] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('from=en')
    expect(url).toContain('to=nb')
    const headers = opts.headers as Record<string, string>
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('akey')
    expect(headers['Ocp-Apim-Subscription-Region']).toBe('westeurope')
    expect(JSON.parse(opts.body as string)).toEqual([{ Text: 'Hello' }])
  })

  it('omits the region header when no region is set', async () => {
    vi.stubEnv('TRANSLATE_PROVIDER', 'azure')
    vi.stubEnv('AZURE_TRANSLATOR_KEY', 'akey')
    vi.stubEnv('AZURE_TRANSLATOR_REGION', '')
    const fn = mockFetch({ ok: true, json: async () => ([{ translations: [{ text: 'x' }] }]) })
    await translate('a', 'en', 'no')
    const headers = (fn.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['Ocp-Apim-Subscription-Region']).toBeUndefined()
  })
})

// ─── llm provider (reuses the Summarize model) ───────────────────────────────

describe("translate() — 'llm' provider", () => {
  /** Point the summarize side at a local model so 'llm' is configured. */
  function configureLlm() {
    vi.stubEnv('TRANSLATE_PROVIDER', 'llm')
    vi.stubEnv('SUMMARIZE_PROVIDER', 'ollama')
    vi.stubEnv('SUMMARIZE_OLLAMA_URL', 'http://localhost:11434')
    vi.stubEnv('SUMMARIZE_MODEL', 'llama3.2:3b')
  }
  const chat = (content: string) => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) })

  it('is configured whenever the summarize side has a model', () => {
    configureLlm()
    expect(isTranslationConfigured()).toBe(true)
  })

  it('is NOT configured when no summarize model is set', () => {
    vi.stubEnv('TRANSLATE_PROVIDER', 'llm')
    vi.stubEnv('SUMMARIZE_PROVIDER', 'ollama')
    vi.stubEnv('SUMMARIZE_MODEL', '')
    expect(isTranslationConfigured()).toBe(false)
  })

  it('calls the summarize endpoint/model and returns the reply', async () => {
    configureLlm()
    const fn = mockFetch(chat('Hei verden'))
    expect(await translate('Hello world', 'en', 'no')).toBe('Hei verden')

    const [url, opts] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
    const body = JSON.parse(opts.body as string)
    expect(body.model).toBe('llama3.2:3b')
    // The prompt must name both languages in words, not codes.
    expect(body.messages[0].content).toContain('English')
    expect(body.messages[0].content).toContain('Norwegian')
    expect(body.messages[1].content).toBe('Hello world')
  })

  it('disambiguates Norwegian as Bokmål so it is not answered in Swedish', async () => {
    // Regression: en→no came back Swedish because "Norwegian" alone doesn't pin
    // the variant for a small model. The target now carries the Bokmål name.
    configureLlm()
    const fn = mockFetch(chat('Hei'))
    await translate('Hi', 'en', 'no')
    const prompt = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string).messages[0].content
    expect(prompt).toContain('Bokmål')
    expect(prompt).not.toContain('Swedish')
  })

  it('states the target language emphatically and last (recency)', async () => {
    // Small models weight the final instruction heavily, so the target must be
    // named more than once and appear at the very end.
    configureLlm()
    const fn = mockFetch(chat('Hei'))
    await translate('Hi', 'en', 'no')
    const prompt: string = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string).messages[0].content
    const occurrences = prompt.match(/Norwegian/g)?.length ?? 0
    expect(occurrences).toBeGreaterThanOrEqual(2)
    // The closing sentence pins the output language.
    expect(prompt.trimEnd()).toMatch(/Norwegian[^.]*\.$/)
  })

  it('names every offered locale rather than sending a bare code', async () => {
    configureLlm()
    mockFetch(chat('x'))
    // Locales added in the 15-locale work — these must be nameable or the
    // prompt would read "translate to undefined".
    for (const [code, name] of [['fi', 'Finnish'], ['uk', 'Ukrainian'], ['is', 'Icelandic']] as const) {
      const fn = mockFetch(chat('x'))
      await translate('a', 'en', code)
      const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
      expect(body.messages[0].content, code).toContain(name)
    }
  })

  it('rejects a locale it cannot name instead of guessing', async () => {
    configureLlm()
    const fn = mockFetch(chat('x'))
    await expect(translate('a', 'en', 'zz')).rejects.toThrow(TranslateError)
    // Fails before any upstream call — no wasted round-trip, no wrong language.
    expect(fn).not.toHaveBeenCalled()
  })

  it('strips fences/wrapping quotes but keeps multi-line bodies intact', async () => {
    configureLlm()
    mockFetch(chat('```\nLinje én\nLinje to\n```'))
    expect(await translate('a', 'en', 'no')).toBe('Linje én\nLinje to')
  })

  it('keeps inner quotes (only whole-text wrapping quotes are stripped)', async () => {
    configureLlm()
    mockFetch(chat('Han sa "hei" til meg'))
    expect(await translate('a', 'en', 'no')).toBe('Han sa "hei" til meg')
  })

  it('maps an upstream failure onto a TranslateError', async () => {
    configureLlm()
    mockFetch({ ok: false, status: 404 })
    await expect(translate('a', 'en', 'no')).rejects.toThrow(TranslateError)
  })

  it('errors when the model returns nothing usable', async () => {
    configureLlm()
    mockFetch(chat('   '))
    await expect(translate('a', 'en', 'no')).rejects.toThrow(TranslateError)
  })
})

// ─── ltLoadOnly (which Argos models the Docker instance installs) ─────────────

describe('ltLoadOnly()', () => {
  it('maps app codes to the service codes LibreTranslate expects', () => {
    expect(ltLoadOnly(['en', 'no', 'se', 'dk'])).toBe('da,en,nb,sv')
  })

  it('always includes English (Argos pivots through it)', () => {
    expect(ltLoadOnly(['de']).split(',')).toContain('en')
    expect(ltLoadOnly([])).toBe('en')
  })

  it('passes through the locales that are already ISO 639-1', () => {
    expect(ltLoadOnly(['fi', 'uk', 'pl'])).toBe('en,fi,pl,uk')
  })

  it('dedupes and sorts so the value is stable across orderings', () => {
    // The caller compares this string to decide whether to recreate the
    // container — an unstable order would churn it on every save.
    expect(ltLoadOnly(['no', 'en', 'no'])).toBe(ltLoadOnly(['en', 'no']))
    expect(ltLoadOnly(['se', 'de'])).toBe(ltLoadOnly(['de', 'se']))
  })
})

// ─── DeepL code casing (regression: the 8 locales added in the i18n work) ────

describe('DeepL locale codes', () => {
  function deeplBody(source: string, target: string) {
    vi.stubEnv('TRANSLATE_PROVIDER', 'deepl')
    vi.stubEnv('DEEPL_API_KEY', 'k')
    const fn = mockFetch({ ok: true, json: async () => ({ translations: [{ text: 'x' }] }) })
    return { fn, run: () => translate('a', source, target) }
  }

  it('upper-cases a locale that has no explicit entry', async () => {
    // DeepL rejects a lower-case code. Before this fix the fallback lower-cased,
    // so every locale added beyond the original seven silently failed.
    const { fn, run } = deeplBody('en', 'fi')
    await run()
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.target_lang).toBe('FI')
    expect(body.source_lang).toBe('EN')
  })

  it('keeps the explicit mappings (NB for Norwegian, EN-GB as a target)', async () => {
    const { fn, run } = deeplBody('no', 'en')
    await run()
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.source_lang).toBe('NB')
    expect(body.target_lang).toBe('EN-GB')
  })
})
