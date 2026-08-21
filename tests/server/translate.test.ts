import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  toServiceLocale,
  isTranslationConfigured,
  translate,
  ltLoadOnly,
  looksWrongLanguage,
  tidyTranslation,
  TranslateError,
} from '../../server/translate'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})


/**
 * The last thing that touches a model's translation before it becomes the
 * user's CV text — and it had no test at all, which is every one of its thirty
 * surviving mutants.
 *
 * Unlike the summarize path's tidyLine, this must PRESERVE the body: a CV field
 * runs to several sentences or lines. Only the wrapper comes off.
 */
describe('tidyTranslation()', () => {
  it('leaves ordinary text alone, bar surrounding whitespace', () => {
    expect(tidyTranslation('  Ledet en skymigrering.  ')).toBe('Ledet en skymigrering.')
  })

  it('keeps a multi-line body intact', () => {
    const body = 'Første avsnitt.\n\nAndre avsnitt.'
    expect(tidyTranslation(body)).toBe(body)
  })

  it('strips a code fence, tagged or bare', () => {
    expect(tidyTranslation('```\nLedet en skymigrering.\n```')).toBe('Ledet en skymigrering.')
    expect(tidyTranslation('```text\nLedet en skymigrering.\n```')).toBe('Ledet en skymigrering.')
  })

  it('strips the delimiter lines the prompt wraps the source in', () => {
    // Delimiters are what make a weak model treat the text as data rather than
    // instructions; the price is that it sometimes echoes them back.
    expect(tidyTranslation('###\nLedet en skymigrering.\n###')).toBe('Ledet en skymigrering.')
  })

  it('keeps a ### that is part of the text', () => {
    // Leading and trailing only. A row of hashes inside the body is the user's.
    const body = 'Før.\n###\nEtter.'
    expect(tidyTranslation(body)).toBe(body)
  })

  it('strips quotes that wrap the WHOLE text', () => {
    expect(tidyTranslation('"Ledet en skymigrering."')).toBe('Ledet en skymigrering.')
    expect(tidyTranslation('“Ledet en skymigrering.”')).toBe('Ledet en skymigrering.')
  })

  it('keeps quotes that are part of the sentence', () => {
    // The test is whether they ENCLOSE everything. An inner quote means they do
    // not, and stripping would take a character off each end of real text.
    const inner = 'Han sa "hei" til kunden.'
    expect(tidyTranslation(inner)).toBe(inner)
    expect(tidyTranslation('"Hei" og "hade"')).toBe('"Hei" og "hade"')
  })

  it('does not strip a lone quote character', () => {
    // length > 1 guards this: a single `"` both starts and ends the string.
    expect(tidyTranslation('"')).toBe('"')
  })

  it('handles an empty reply without inventing one', () => {
    expect(tidyTranslation('')).toBe('')
    expect(tidyTranslation('   ')).toBe('')
  })

  it('strips a fence and the quotes inside it', () => {
    // A model that does both. Each pass runs in turn, so the order matters.
    expect(tidyTranslation('```\n"Ledet en skymigrering."\n```')).toBe('Ledet en skymigrering.')
  })
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

  it('treats an INHERITED key as unknown, which `??` would not', () => {
    // SECURITY: the locale comes off the request body. Every object literal
    // inherits 'toString'/'constructor'/…, so a plain `MAP[code] ?? fallback`
    // returns a FUNCTION for those — neither null nor undefined, so the
    // fallback never fires and the function's source goes upstream as the
    // target language.
    for (const key of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      expect(toServiceLocale(key), key).toBe(key.toLowerCase())
    }
  })
})

describe('looksWrongLanguage() — inherited keys', () => {
  it('returns no opinion instead of throwing', () => {
    // The target also comes off the request. An inherited key read a function
    // out of the rivals map — truthy past the guard, then a TypeError at the
    // `for…of`, i.e. a 500 rather than "no opinion".
    for (const key of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      expect(() => looksWrongLanguage('en helt vanlig setning', key), key).not.toThrow()
      expect(looksWrongLanguage('en helt vanlig setning', key), key).toBe(false)
    }
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
    // The source text rides in the user turn, delimited, with the task around it.
    expect(body.messages[1].content).toContain('Hello world')
    expect(body.messages[1].content).toContain('###')
  })

  it('restates the target in the user turn, not only in the system message', async () => {
    // The failure this fixes: an instruction that lives only in the system
    // message is the furthest thing from the generation point, and some Ollama
    // chat templates dilute or drop it outright. The target is named in the turn
    // the model reads last — above the text and below it.
    configureLlm()
    const fn = mockFetch(chat('Hei verden'))
    await translate('Hello world', 'en', 'no')
    const user: string = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string).messages[1].content
    expect(user.match(/Norwegian/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    // …and it CLOSES in the target language itself.
    expect(user.trimEnd().endsWith('Skriv hele svaret på norsk bokmål.')).toBe(true)
  })

  it('translates deterministically', async () => {
    // Sampling is one of the ways a model wanders into a neighbouring language,
    // and there is a right answer here.
    configureLlm()
    const fn = mockFetch(chat('Hei'))
    await translate('Hi', 'en', 'no')
    expect(JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string).temperature).toBe(0)
  })

  it('never names the languages it must avoid', async () => {
    // Writing "not Swedish" puts Swedish in the context, which is the opposite
    // of what a confusable target needs.
    configureLlm()
    const fn = mockFetch(chat('Hei'))
    await translate('Hi', 'en', 'no')
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    const whole = `${body.messages[0].content}\n${body.messages[1].content}`
    expect(whole).not.toContain('Swedish')
    expect(whole).not.toContain('Danish')
  })

  it('does not let a "$1" in the source text corrupt the prompt', async () => {
    // String.replace substitution patterns: '$&' would have injected the whole
    // template back into the user turn.
    configureLlm()
    const fn = mockFetch(chat('ok'))
    await translate('Save $1 per unit — $& and $` too', 'en', 'no')
    const user: string = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string).messages[1].content
    expect(user).toContain('Save $1 per unit — $& and $` too')
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
    // The closing sentence pins the output language — written in it.
    expect(prompt.trimEnd().endsWith('Skriv hele svaret på norsk bokmål.')).toBe(true)
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

  it('strips echoed ### markers but keeps one inside the body', async () => {
    configureLlm()
    mockFetch(chat('###\nHei verden\n###'))
    expect(await translate('a', 'en', 'no')).toBe('Hei verden')

    mockFetch(chat('Se ### i koden'))
    expect(await translate('a', 'en', 'no')).toBe('Se ### i koden')
  })

  it('keeps the glossary above the closing language line', async () => {
    // The glossary is a constraint on HOW to translate; the language is WHAT to
    // answer in. Appending the glossary last (as it used to be) buried the one
    // instruction this whole prompt exists to get right.
    configureLlm()
    const fn = mockFetch(chat('Hei'))
    await translate('a', 'en', 'no', undefined, { terms: [{ from: 'board', to: 'styre' }], keep: [] })
    const system: string = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string).messages[0].content
    expect(system).toContain('styre')
    expect(system.indexOf('styre')).toBeLessThan(system.indexOf('Skriv hele svaret'))
  })

  // ── The wrong-language guard ───────────────────────────────────────────────

  it('retries once when the reply comes back in a neighbouring language', async () => {
    // The reported bug: a Norwegian target answered in Swedish. Prompting alone
    // has been strengthened twice for this; the guard is what makes it stop.
    configureLlm()
    const fn = vi.fn()
      .mockResolvedValueOnce(chat('Erfaren utvecklare som arbetar med och för molntjänster'))
      .mockResolvedValueOnce(chat('Erfaren utvikler som jobber med skytjenester'))
    vi.stubGlobal('fetch', fn)

    expect(await translate('Experienced developer', 'en', 'no'))
      .toBe('Erfaren utvikler som jobber med skytjenester')
    expect(fn).toHaveBeenCalledTimes(2)

    // The retry names the miss without naming the wrong language.
    const second: string = JSON.parse((fn.mock.calls[1][1] as RequestInit).body as string).messages[1].content
    expect(second).toContain('previous attempt')
    expect(second).not.toContain('Swedish')
  })

  it('does not retry a good translation', async () => {
    configureLlm()
    const fn = mockFetch(chat('Erfaren utvikler som ikke jobber med sertifisering'))
    await translate('Experienced developer', 'en', 'no')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('keeps the first answer when the retry itself fails', async () => {
    // A suspect draft the user can fix beats an error message — the whole
    // feature is review-required anyway.
    configureLlm()
    const fn = vi.fn()
      .mockResolvedValueOnce(chat('Erfaren utvecklare och är mycket engagerad'))
      .mockResolvedValueOnce({ ok: false, status: 500 })
    vi.stubGlobal('fetch', fn)
    expect(await translate('x', 'en', 'no')).toBe('Erfaren utvecklare och är mycket engagerad')
  })

  it('keeps the second attempt even when it also looks wrong', async () => {
    // Better a draft the user can fix than a third round-trip they wait on.
    configureLlm()
    const fn = vi.fn()
      .mockResolvedValueOnce(chat('Erfaren utvecklare och är mycket för detta'))
      .mockResolvedValueOnce(chat('Erfaren utvecklare och är mycket för detta igen'))
    vi.stubGlobal('fetch', fn)
    expect(await translate('x', 'en', 'no')).toBe('Erfaren utvecklare och är mycket för detta igen')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('looksWrongLanguage()', () => {
  it('spots Swedish returned for a Norwegian target', () => {
    expect(looksWrongLanguage('Erfaren utvecklare och är mycket engagerad', 'no')).toBe(true)
  })

  it('spots Danish returned for a Norwegian target', () => {
    expect(looksWrongLanguage('Ansvarlig for kommunikation af nogle projekter', 'no')).toBe(true)
  })

  it('spots Norwegian returned for a Swedish target', () => {
    expect(looksWrongLanguage('Ansvarlig for informasjon, ikke mye annet', 'se')).toBe(true)
  })

  it('passes correct Norwegian, including Swedish proper nouns in it', () => {
    expect(looksWrongLanguage('Erfaren utvikler med ansvar for sertifisering', 'no')).toBe(false)
    // One Swedish-looking token is a customer name, not a language — firing here
    // would cost a re-run on a translation that was already right.
    expect(looksWrongLanguage('Leverte plattformen til Öhlins i Sverige', 'no')).toBe(false)
  })

  it('says nothing about a target outside the Scandinavian trio', () => {
    // A model does not answer a French request in Polish; a guess here would be
    // all false positives.
    expect(looksWrongLanguage('Développeur expérimenté och är', 'fr')).toBe(false)
  })

  it('does not fire on text too short to carry evidence', () => {
    expect(looksWrongLanguage('Utvikler', 'no')).toBe(false)
    expect(looksWrongLanguage('', 'no')).toBe(false)
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

describe('the per-provider locale maps — inherited keys', () => {
  // `toServiceLocale` (LibreTranslate) already guarded this; the Google, Azure
  // and DeepL maps went through `mapWith`/`mapDeepL`, which still used `??`.
  // Same request-body input, same hole, three providers further down.
  const INHERITED = ['toString', 'constructor', 'valueOf', 'hasOwnProperty']

  it('Google sends the bare code, not a function', async () => {
    vi.stubEnv('TRANSLATE_PROVIDER', 'google')
    vi.stubEnv('GOOGLE_TRANSLATE_API_KEY', 'gkey')
    for (const key of INHERITED) {
      const fn = mockFetch({ ok: true, json: async () => ({ data: { translations: [{ translatedText: 'x' }] } }) })
      await translate('Hello', key, 'no')
      const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
      // Without the guard `source` held a FUNCTION, which JSON.stringify drops
      // entirely — so Google silently auto-detected instead of erroring.
      expect(body.source, key).toBe(key.toLowerCase())
    }
  })

  it('Azure sends the bare code, not a stringified function', async () => {
    vi.stubEnv('TRANSLATE_PROVIDER', 'azure')
    vi.stubEnv('AZURE_TRANSLATOR_KEY', 'akey')
    for (const key of INHERITED) {
      const fn = mockFetch({ ok: true, json: async () => ([{ translations: [{ text: 'x' }] }]) })
      await translate('Hello', key, 'no')
      const url = fn.mock.calls[0][0] as string
      // encodeURIComponent(fn) wrote `function toString() { [native code] }`
      // into the query — encoded, so never injection, but never a locale either.
      expect(url, key).toContain(`from=${key.toLowerCase()}`)
      expect(url, key).not.toContain('native')
    }
  })

  it('DeepL sends the upper-cased bare code', async () => {
    vi.stubEnv('TRANSLATE_PROVIDER', 'deepl')
    vi.stubEnv('DEEPL_API_KEY', 'dkey')
    for (const key of INHERITED) {
      const fn = mockFetch({ ok: true, json: async () => ({ translations: [{ text: 'x' }] }) })
      await translate('Hello', key, 'no')
      const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
      expect(body.source_lang, key).toBe(key.toUpperCase())
    }
  })
})
