/**
 * C3 (server half) — the glossary as it arrives on the wire, and the
 * per-provider machinery for honouring it.
 *
 * The client derives the glossary from the resume and scopes it to the text
 * being translated (`src/lib/glossary.ts`); the server never sees the CV, so it
 * can't build this itself. What arrives is a handful of term pairs plus a list
 * of names to leave alone — everything in it already appears in the text being
 * translated, so nothing extra is disclosed.
 *
 * Untrusted input, so it is capped and charset-checked here before it can reach
 * a prompt, an upstream API or (worst case) a DeepL glossary resource.
 *
 * Provider support is genuinely uneven, and this module is where that lives:
 *   llm     — terms go in the prompt. Exact, no extra API calls.
 *   deepl   — a REAL glossary resource, created once per (pair + content) and
 *             reused by id. This is the only provider with first-class support.
 *   google  — v2 has no glossary API at all (that's v3 Advanced, which needs a
 *             service account and a GCS bucket, not an API key). What v2 does
 *             have is `format=html` + `notranslate`, which is enough to protect
 *             names and to pin a term to its agreed rendering. See
 *             `googleMarkup`.
 *   libre / azure — untouched. LibreTranslate has nothing to hook into.
 */

/** One term pair as the client sends it. */
export interface WireTerm { from: string; to: string }

export interface WireGlossary {
  terms: WireTerm[]
  /** Names that must survive untranslated. */
  keep: string[]
}

/** Caps — the client already scopes, this is the guard against a hostile body. */
const MAX_ENTRIES = 50
const MAX_TERM_CHARS = 80

/**
 * Coerce an untrusted body into a glossary, or undefined.
 *
 * Control characters are stripped rather than rejected: they'd break a DeepL
 * TSV upload (which is newline/tab delimited) and could smuggle instructions
 * into an LLM prompt. Everything else passes — CV terminology legitimately
 * contains slashes, dots, plus signs and every accent in Europe.
 */
export function parseGlossary(raw: unknown): WireGlossary | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>

  const clean = (v: unknown): string => {
    if (typeof v !== 'string') return ''
    // Control characters go first: they would break a DeepL TSV upload (tab and
    // newline delimited) and could smuggle instructions into an LLM prompt.
    // Built by code point rather than written as an escape inside a regex
    // literal, because such an escape does not reliably survive the tooling
    // that writes this file.
    let out = ''
    for (const ch of v) {
      const cp = ch.codePointAt(0) ?? 0
      out += cp < 0x20 || cp === 0x7f ? ' ' : ch
    }
    return out.replace(/\s+/g, ' ').trim().slice(0, MAX_TERM_CHARS)
  }

  const terms: WireTerm[] = []
  for (const t of Array.isArray(o.terms) ? o.terms.slice(0, MAX_ENTRIES) : []) {
    if (!t || typeof t !== 'object') continue
    const from = clean((t as Record<string, unknown>).from)
    const to = clean((t as Record<string, unknown>).to)
    if (from && to && from.toLowerCase() !== to.toLowerCase()) terms.push({ from, to })
  }

  const keep: string[] = []
  for (const k of Array.isArray(o.keep) ? o.keep.slice(0, MAX_ENTRIES) : []) {
    const v = clean(k)
    if (v) keep.push(v)
  }

  return terms.length || keep.length ? { terms, keep } : undefined
}

/** The prompt block for the LLM provider. Empty string when there's nothing. */
export function glossaryPromptBlock(g: WireGlossary | undefined): string {
  if (!g) return ''
  const lines: string[] = []
  if (g.terms.length) {
    lines.push(
      'TERMINOLOGY — this CV already uses these renderings. Use them exactly,',
      'adjusting only for grammar (case, inflection, definiteness):',
      ...g.terms.map((t) => `  ${t.from} → ${t.to}`),
    )
  }
  if (g.keep.length) {
    if (lines.length) lines.push('')
    lines.push(
      'DO NOT TRANSLATE these names — reproduce them character for character:',
      ...g.keep.map((k) => `  ${k}`),
    )
  }
  return lines.join('\n')
}

// ─── DeepL glossaries ────────────────────────────────────────────────────────

/**
 * DeepL glossaries are server-side resources: you create one for a language
 * pair with a TSV body, get an id, and pass that id on each translate call.
 * Creating one per request would be absurd (an extra round-trip each time, and
 * an unbounded pile of resources on DeepL's side), so ids are cached by
 * (pair + content hash) and the previous glossary for a pair is deleted when
 * its content changes.
 *
 * The cache is in-process and deliberately not persisted: a restart costs one
 * extra create, and a stale id would cost a failed translation.
 */
interface CachedGlossary { id: string; hash: string }

const deeplCache = new Map<string, CachedGlossary>()

/** Cheap, stable content hash — collision risk here costs a re-create, nothing more. */
function hashEntries(entries: readonly WireTerm[]): string {
  const text = entries.map((t) => `${t.from}\t${t.to}`).sort().join('\n')
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `${(h >>> 0).toString(36)}:${entries.length}`
}

/**
 * The glossary entries DeepL should hold: the term pairs, plus every `keep`
 * name mapped to itself. An identity entry is how you say "leave this alone" in
 * a glossary, so one mechanism covers both halves.
 *
 * DeepL rejects duplicate source entries, so the first spelling of a term wins.
 */
export function deeplEntries(g: WireGlossary): WireTerm[] {
  const byFrom = new Map<string, WireTerm>()
  for (const t of g.terms) {
    const key = t.from.toLowerCase()
    if (!byFrom.has(key)) byFrom.set(key, t)
  }
  for (const k of g.keep) {
    const key = k.toLowerCase()
    if (!byFrom.has(key)) byFrom.set(key, { from: k, to: k })
  }
  // A TSV can't carry tabs or newlines inside a field; parseGlossary already
  // stripped them, but this is the boundary that would break, so be explicit.
  return [...byFrom.values()].filter((t) => !/[\t\n\r]/.test(t.from + t.to))
}

interface DeeplCtx {
  host: string
  key: string
  /** DeepL glossary language codes are 2-letter and lowercase, unlike translate. */
  sourceLang: string
  targetLang: string
}

/**
 * Get (or create) a DeepL glossary id for this content. Returns null on ANY
 * failure — a glossary is an enhancement, and losing the translation because
 * the glossary API had a bad day would be a poor trade. Callers translate
 * without it.
 */
export async function ensureDeeplGlossary(
  g: WireGlossary,
  ctx: DeeplCtx,
  timeoutMs: number,
): Promise<string | null> {
  const entries = deeplEntries(g)
  if (!entries.length) return null

  // DeepL glossaries only exist for pairs it supports, and only for 2-letter
  // codes — 'EN-GB' is valid for translation but not for a glossary.
  const src = ctx.sourceLang.slice(0, 2).toLowerCase()
  const tgt = ctx.targetLang.slice(0, 2).toLowerCase()
  if (src === tgt) return null

  const cacheKey = `${src}>${tgt}`
  const hash = hashEntries(entries)
  const cached = deeplCache.get(cacheKey)
  if (cached && cached.hash === hash) return cached.id

  const auth = { Authorization: `DeepL-Auth-Key ${ctx.key}` }
  try {
    const res = await fetch(`${ctx.host}/v2/glossaries`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `resume-studio-${cacheKey}`,
        source_lang: src,
        target_lang: tgt,
        entries: entries.map((t) => `${t.from}\t${t.to}`).join('\n'),
        entries_format: 'tsv',
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const json = await res.json().catch(() => null) as { glossary_id?: string } | null
    const id = json?.glossary_id
    if (typeof id !== 'string' || !id) return null

    // Replace, don't accumulate: the old one for this pair is now dead weight
    // on an account with a glossary limit. Best-effort and unawaited-safe.
    if (cached) {
      void fetch(`${ctx.host}/v2/glossaries/${encodeURIComponent(cached.id)}`, {
        method: 'DELETE',
        headers: auth,
        signal: AbortSignal.timeout(timeoutMs),
      }).catch(() => undefined)
    }
    deeplCache.set(cacheKey, { id, hash })
    return id
  } catch {
    return null
  }
}

/** Test seam — the cache is module state, so tests need to clear it. */
export function resetDeeplGlossaryCache(): void {
  deeplCache.clear()
}

// ─── Google (v2) ─────────────────────────────────────────────────────────────

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])
const unescapeHtml = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Google Translate v2 has no glossary parameter — glossaries are a v3 Advanced
 * feature requiring a service account and a Cloud Storage bucket, which an API
 * key cannot reach. What v2 *does* honour is `format=html` plus the standard
 * `notranslate` class, so the terminology can be enforced structurally instead:
 *
 *   keep  → wrap the name as-is. Google returns it untouched.
 *   term  → substitute the agreed TARGET wording, wrapped. Google leaves it
 *           alone and it lands already translated, which is exactly the
 *           glossary behaviour.
 *
 * Longest terms first so "Cloud operations" is consumed before "Cloud", and
 * whole-term matching only (Unicode-aware, because `\b` mishandles Norwegian).
 *
 * The honest caveat: substituting a target-language noun into a source-language
 * sentence can leave an inflection slightly off in the output. That is a
 * cosmetic edit on a draft the user reviews anyway, and it is a better trade
 * than the term coming back three different ways across the CV.
 */
export function googleMarkup(text: string, g: WireGlossary | undefined): { html: string; used: boolean } {
  if (!g) return { html: text, used: false }

  const replacements: Array<{ match: string; render: string }> = [
    ...g.terms.map((t) => ({ match: t.from, render: t.to })),
    ...g.keep.map((k) => ({ match: k, render: k })),
  ].sort((a, b) => b.match.length - a.match.length)

  let used = false
  // Protect segment by segment so a later, shorter term can't match inside a
  // span already emitted for a longer one.
  let segments: Array<{ text: string; frozen: boolean }> = [{ text, frozen: false }]

  for (const { match, render } of replacements) {
    if (!match) continue
    let re: RegExp
    try {
      re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(match)}(?![\\p{L}\\p{N}])`, 'giu')
    } catch { continue }

    const next: typeof segments = []
    for (const seg of segments) {
      if (seg.frozen) { next.push(seg); continue }
      const parts = seg.text.split(re)
      if (parts.length === 1) { next.push(seg); continue }
      used = true
      parts.forEach((p, i) => {
        if (i > 0) next.push({ text: render, frozen: true })
        if (p) next.push({ text: p, frozen: false })
      })
    }
    segments = next
  }

  if (!used) return { html: text, used: false }
  const html = segments
    .map((s) => (s.frozen
      ? `<span class="notranslate">${escapeHtml(s.text)}</span>`
      : escapeHtml(s.text)))
    .join('')
  return { html, used: true }
}

/**
 * Undo `googleMarkup`: strip the protective spans and decode the entities
 * Google's HTML mode returns. Only ever called on a response we marked up, so a
 * plain-text passthrough is never touched.
 */
export function googleUnmarkup(html: string): string {
  return unescapeHtml(html.replace(/<\/?span[^>]*>/gi, ''))
}
