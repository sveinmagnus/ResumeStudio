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
