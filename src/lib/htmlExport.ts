/**
 * Standalone single-file HTML export.
 *
 * `buildViewHtml` produces a complete document, but one that assumes an
 * origin: its @font-face blocks reference `/fonts/*.woff2` and its CSP grants
 * `font-src 'self'`. Saved to disk and opened from file://, `'self'` is
 * meaningless — the fonts fail and the policy blocks nothing useful. This
 * module rewrites that finished document into one that references NO origin:
 * brand fonts inlined as data: URIs, CSP narrowed to `data:`. Images need no
 * work — lib/image re-encodes every upload to a data: URL, so they are
 * self-contained by construction.
 *
 * The rewrites are exact-literal string surgery over buildViewHtml's output
 * rather than options threaded through it, so the SECURITY-CRITICAL builder
 * stays untouched. The cost is coupling to its exact output; the drift guard
 * in tests/htmlExport.test.ts fails loudly if the font paths or CSP literals
 * ever change shape there.
 */
import { buildViewHtml } from './viewFilter'
import { lookup } from './lookup'
import type { GlobalFonts } from './fonts'
import type { ResumeStore, ResumeView } from '../types'

/** The exact `/fonts/*.woff2` paths buildViewHtml's @font-face blocks cite. */
export const STANDALONE_FONT_FILES: readonly string[] = [
  '/fonts/open-sans-condensed-300-latin.woff2',
  '/fonts/open-sans-condensed-300-latin-ext.woff2',
  '/fonts/ubuntu-400-latin.woff2',
  '/fonts/ubuntu-400-latin-ext.woff2',
  '/fonts/ubuntu-500-latin.woff2',
  '/fonts/ubuntu-500-latin-ext.woff2',
]

/** ArrayBuffer → base64 without Node's Buffer — this runs in the browser. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // Chunked so String.fromCharCode never sees an argument list long enough
  // to overflow the call stack on a full-size font file.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * Fetch every standalone font and return path → `data:font/woff2;base64,…`.
 *
 * Best-effort by design: a failed fetch omits that entry and never throws —
 * the document's font stacks still name OS fallbacks, so a missing brand font
 * degrades the look, not the export.
 */
export async function collectFontAssets(fetchImpl?: typeof fetch): Promise<Record<string, string>> {
  // Bound so a bare browser `fetch` isn't called with a stripped `this`.
  const doFetch = fetchImpl ?? fetch.bind(globalThis)
  const out: Record<string, string> = {}
  await Promise.all(STANDALONE_FONT_FILES.map(async (path) => {
    try {
      const res = await doFetch(path)
      if (!res.ok) return
      const buf = await res.arrayBuffer()
      out[path] = `data:font/woff2;base64,${bytesToBase64(new Uint8Array(buf))}`
    } catch {
      // Omitted entry → buildStandaloneViewHtml drops the whole block.
    }
  }))
  return out
}

/**
 * The single `@font-face { … }` block citing `path`. Blocks in the source are
 * one brace pair with no nesting, so a bounded `[^{}]*` walk cannot escape one
 * block and eat the next.
 */
function fontFaceBlockRe(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(String.raw`[ \t]*@font-face\s*\{[^{}]*${escaped}[^{}]*\}[ \t]*\r?\n?`)
}

/**
 * buildViewHtml's document, made genuinely self-contained: fonts with data
 * inlined as data: URIs, fonts without data removed whole (a dead `src` still
 * fails from file://; the fallback stack renders instead), and the CSP's two
 * `'self'` grants narrowed to `data:` since no origin exists to be 'self' of.
 */
export function buildStandaloneViewHtml(
  store: ResumeStore,
  view: ResumeView,
  locale: string,
  globalFonts: GlobalFonts | undefined,
  fontData: Record<string, string>,
): string {
  let html = buildViewHtml(store, view, locale, globalFonts)

  for (const path of STANDALONE_FONT_FILES) {
    const dataUri = lookup(fontData, path, '')
    if (dataUri) {
      // split/join: literal replacement with no regex or `$`-pattern hazards.
      html = html.split(`url('${path}')`).join(`url('${dataUri}')`)
    } else {
      html = html.replace(fontFaceBlockRe(path), '')
    }
  }

  // First occurrence only — the CSP meta precedes any user-authored content.
  html = html.replace("font-src 'self'", 'font-src data:')
  html = html.replace("img-src 'self' data:", 'img-src data:')
  return html
}
