import { describe, it, expect } from 'vitest'
import { buildViewHtml, buildViewSections } from '../src/lib/viewFilter'
import {
  STANDALONE_FONT_FILES, collectFontAssets, buildStandaloneViewHtml,
} from '../src/lib/htmlExport'
import { emptyStore, makeProject, makeView } from './fixtures'
import type { ResumeStore } from '../src/types'

function baseStore(): ResumeStore {
  const store = emptyStore()
  store.projects.push(makeProject())
  return store
}

const fullView = () => makeView({ sections: buildViewSections() })

/** Distinct tiny data URIs per path so each inline is individually assertable. */
function fakeFontData(paths: readonly string[] = STANDALONE_FONT_FILES): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of paths) out[p] = `data:font/woff2;base64,${btoa(p)}`
  return out
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

// ─── Drift guard against viewFilter ──────────────────────────────────────────
//
// buildStandaloneViewHtml is exact-literal surgery over buildViewHtml's
// output. These assertions run against the UNTRANSFORMED base document, so a
// change to viewFilter's font paths or CSP shape fails here loudly instead of
// silently shipping a standalone doc with dead references.

describe('drift guard: buildViewHtml vs STANDALONE_FONT_FILES', () => {
  it('every /fonts/ reference in the base document is in STANDALONE_FONT_FILES', () => {
    const html = buildViewHtml(baseStore(), fullView(), 'en')
    const refs = [...html.matchAll(/\/fonts\/[^')]+/g)].map((m) => m[0])
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      expect(STANDALONE_FONT_FILES).toContain(ref)
    }
  })

  it('every listed font file is actually referenced (the list stays exact)', () => {
    const html = buildViewHtml(baseStore(), fullView(), 'en')
    expect(STANDALONE_FONT_FILES).toHaveLength(6)
    for (const path of STANDALONE_FONT_FILES) {
      expect(html).toContain(`url('${path}')`)
    }
  })

  it('the two CSP literals the transform rewrites are present verbatim', () => {
    const html = buildViewHtml(baseStore(), fullView(), 'en')
    expect(html).toContain("font-src 'self'")
    expect(html).toContain("img-src 'self' data:")
  })
})

// ─── buildStandaloneViewHtml ─────────────────────────────────────────────────

describe('buildStandaloneViewHtml()', () => {
  it('with full fontData: inlines every font, leaves no origin reference', () => {
    const fontData = fakeFontData()
    const html = buildStandaloneViewHtml(baseStore(), fullView(), 'en', undefined, fontData)

    for (const path of STANDALONE_FONT_FILES) {
      expect(html).toContain(`url('${fontData[path]}')`)
    }
    expect(html).not.toContain('/fonts/')
    expect(count(html, '@font-face')).toBe(6)
  })

  it('rewrites the CSP to data: sources and keeps the rest of the policy', () => {
    const html = buildStandaloneViewHtml(baseStore(), fullView(), 'en', undefined, fakeFontData())
    expect(html).toContain('font-src data:')
    expect(html).toContain('img-src data:')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("style-src 'unsafe-inline'")
    expect(html).not.toContain("font-src 'self'")
    expect(html).not.toContain("img-src 'self'")
  })

  it('with partial fontData: removes the un-fed @font-face blocks entirely', () => {
    const openSansOnly = fakeFontData(STANDALONE_FONT_FILES.slice(0, 2))
    const html = buildStandaloneViewHtml(baseStore(), fullView(), 'en', undefined, openSansOnly)

    expect(count(html, '@font-face')).toBe(2)
    expect(html).toContain('data:font/woff2;base64,')
    expect(html).not.toContain('/fonts/')
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('</html>')
  })

  it('block removal matches the full path, not a prefix of a sibling', () => {
    // ubuntu-400-latin missing, ubuntu-400-latin-ext present: the -ext block
    // must survive even though its path contains the missing one as a prefix.
    const paths = STANDALONE_FONT_FILES.filter((p) => p !== '/fonts/ubuntu-400-latin.woff2')
    const fontData = fakeFontData(paths)
    const html = buildStandaloneViewHtml(baseStore(), fullView(), 'en', undefined, fontData)

    expect(count(html, '@font-face')).toBe(5)
    expect(html).toContain(`url('${fontData['/fonts/ubuntu-400-latin-ext.woff2']}')`)
    expect(html).not.toContain('/fonts/')
  })

  it('with empty fontData: every @font-face is gone, document still parses', () => {
    const html = buildStandaloneViewHtml(baseStore(), fullView(), 'en', undefined, {})
    expect(count(html, '@font-face')).toBe(0)
    expect(html).not.toContain('/fonts/')
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('</html>')
  })

  it('never weakens escaping: a script payload in full_name stays escaped', () => {
    const store = baseStore()
    store.resume!.full_name = '<script>alert(1)</script>'
    const html = buildStandaloneViewHtml(store, fullView(), 'en', undefined, fakeFontData())
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;/script&gt;')
  })
})

// ─── collectFontAssets ───────────────────────────────────────────────────────

describe('collectFontAssets()', () => {
  const FONT_BYTES = new Uint8Array([102, 111, 110, 116])
  const FONT_B64 = 'Zm9udA=='

  it('yields a data URI per font on the success path', async () => {
    const fetchMock: typeof fetch = () => Promise.resolve(new Response(FONT_BYTES))
    const assets = await collectFontAssets(fetchMock)

    expect(Object.keys(assets).sort()).toEqual([...STANDALONE_FONT_FILES].sort())
    for (const path of STANDALONE_FONT_FILES) {
      expect(assets[path]).toBe(`data:font/woff2;base64,${FONT_B64}`)
    }
  })

  it('omits a rejected fetch and a non-ok response, keeps the rest', async () => {
    const fetchMock: typeof fetch = (input) => {
      const path = String(input)
      if (path === '/fonts/ubuntu-500-latin.woff2') return Promise.reject(new Error('offline'))
      if (path === '/fonts/ubuntu-500-latin-ext.woff2') {
        return Promise.resolve(new Response('nope', { status: 404 }))
      }
      return Promise.resolve(new Response(FONT_BYTES))
    }
    const assets = await collectFontAssets(fetchMock)

    const expected = STANDALONE_FONT_FILES.filter((p) => !p.startsWith('/fonts/ubuntu-500'))
    expect(Object.keys(assets).sort()).toEqual([...expected].sort())
  })

  it('never throws even when every fetch fails', async () => {
    const fetchMock: typeof fetch = () => Promise.reject(new Error('offline'))
    await expect(collectFontAssets(fetchMock)).resolves.toEqual({})
  })
})
