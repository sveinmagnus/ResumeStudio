import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  toServiceLocale,
  isTranslationConfigured,
  translate,
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
