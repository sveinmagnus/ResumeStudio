/**
 * Resume Studio — limited rich-text support.
 *
 * Description-shaped fields (long_description, summary, abstract, …) allow a
 * narrow inline-formatting subset: bold, italic, underline, unordered list,
 * ordered list. No headings, font sizes, alignment, colors, links, or images
 * — those belong to the export template.
 *
 * Storage format: HTML string per locale. Allowed tag set:
 *   <p>, <br>, <strong>/<b>, <em>/<i>, <u>, <ul>, <ol>, <li>
 *
 * Everything else is stripped on save. This keeps a single shape (string)
 * across LocalizedString, plain-text imports (CVpartner), translation drafts,
 * and exports — at the cost of one sanitise step per write.
 *
 * Pasted content (Word / Google Docs / websites) goes through the richer
 * `cleanPastedHtml` first: it maps style-based bold/italic/underline to tags,
 * keeps paragraph boundaries from divs/headings/tables, converts Word list
 * paragraphs to real lists, and strips clipboard junk — then funnels through
 * `sanitizeRich` as the final gate.
 *
 * Pure module — no React, no DOM globals at module load. We do touch the DOM
 * via DOMParser inside helpers (used in both browser and jsdom tests).
 */

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI',
])

/**
 * Strip everything that isn't on the allowlist. Children of disallowed
 * elements are kept (lifted) when their content is meaningful; the parent
 * tag itself is removed. Attributes are wiped wholesale — we never emit any.
 *
 * `<script>` and `<style>` are removed *with* their children (their content
 * is executable / unsafe and not user-meaningful as flowing text).
 */
export function sanitizeRich(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')
  if (!root) return ''

  // Drop dangerous container tags entirely (with subtree).
  for (const danger of Array.from(root.querySelectorAll('script,style,iframe,object,embed,form,input,textarea,button,svg'))) {
    danger.remove()
  }

  stripComments(root)
  walk(root)
  return root.innerHTML
}

/** Remove comment nodes (Word clipboard HTML is full of them). */
function stripComments(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 8 /* comment */) node.removeChild(child)
    else if (child.nodeType === 1) stripComments(child)
  }
}

function walk(node: Element): void {
  // Iterate over a snapshot since we mutate as we go.
  const children = Array.from(node.children)
  for (const child of children) {
    walk(child)
    if (!ALLOWED_TAGS.has(child.tagName)) {
      // Unwrap: move child's nodes up to where it was, then remove the wrapper.
      const parent = child.parentNode
      if (!parent) continue
      while (child.firstChild) parent.insertBefore(child.firstChild, child)
      parent.removeChild(child)
    } else {
      // Wipe all attributes — we never need them.
      while (child.attributes.length) child.removeAttribute(child.attributes[0].name)
    }
  }
}

// ─── Paste cleaning ──────────────────────────────────────────────────────────

/**
 * Normalise HTML from the clipboard (Word, Google Docs, websites) into the
 * allowed rich-text subset. Beyond what `sanitizeRich` does, this:
 *
 *  - maps style-based formatting to tags (`font-weight:700` → <strong>,
 *    `font-style:italic` → <em>, `text-decoration:underline` → <u>) and
 *    honours negations (Google Docs wraps pastes in
 *    `<b style="font-weight:normal">` — that must NOT read as bold);
 *  - keeps paragraph boundaries: divs/blockquotes/sections become <p>
 *    boundaries, headings become bold paragraphs, table rows become
 *    paragraphs with cells joined by a space;
 *  - converts Word's `MsoListParagraph` runs into real <ul>/<ol>;
 *  - strips comments, `&nbsp;` runs, and empty paragraphs.
 *
 * Ends by funnelling through `sanitizeRich`, which stays the single final
 * gate before storage.
 */
export function cleanPastedHtml(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')
  if (!root) return ''

  stripComments(root)
  for (const junk of Array.from(root.querySelectorAll(
    'script,style,iframe,object,embed,form,input,textarea,button,svg,meta,link,title,xml',
  ))) junk.remove()

  convertWordLists(root)
  for (const child of Array.from(root.children)) normalizePasted(child)
  normalizeWhitespace(root)
  for (const p of Array.from(root.querySelectorAll('p'))) {
    if (!(p.textContent || '').trim()) p.remove()
  }

  // sanitizeRich re-parses; invalid nesting we may have built (e.g. a <p>
  // inside a table-row paragraph) auto-corrects there and can leave empty
  // <p> shells behind — sweep those as a last step.
  return sanitizeRich(root.innerHTML).replace(/<p>(?:\s|<br\s*\/?>)*<\/p>/gi, '')
}

/**
 * Convert plain clipboard text into the storage shape: blank-line-separated
 * chunks become paragraphs, single newlines become <br>. Single-line text is
 * returned escaped but unwrapped so it splices into the caret's paragraph.
 */
export function plainToRichHtml(text: string): string {
  if (!text) return ''
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const normalized = text.replace(/\r\n?/g, '\n')
  if (!normalized.includes('\n')) return esc(normalized)
  return normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).split('\n').join('<br>')}</p>`)
    .join('')
}

/** Non-breaking space (U+00A0), via charCode so the source stays ASCII-visible. */
const NBSP_RE = new RegExp(String.fromCharCode(0xa0), 'g')

/** Block containers that should contribute paragraph boundaries, then vanish. */
const PASTE_BLOCK_CONTAINERS = new Set([
  'DIV', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER',
  'MAIN', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION', 'ADDRESS', 'DL', 'DT', 'DD',
  'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'CAPTION', 'COLGROUP',
])

/** Tags treated as block-level when grouping a container's inline runs. */
const PASTE_BLOCKISH = new Set([...PASTE_BLOCK_CONTAINERS, 'P', 'UL', 'OL', 'LI', 'TR'])

interface PasteFlags { bold: boolean; italic: boolean; underline: boolean }

/**
 * The effective inline formatting an element contributes: its tag semantics,
 * overridden by an inline `style` attribute when present (the attribute wins
 * both ways — `<b style="font-weight:normal">` is not bold, and a styled
 * `<span>` can be).
 */
function effectiveInlineFlags(el: Element): PasteFlags {
  const tag = el.tagName
  const style = el.getAttribute('style') || ''
  const prop = (name: string): string => {
    const m = style.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i'))
    return m ? m[1].trim().toLowerCase() : ''
  }
  const fw = prop('font-weight')
  const bold = fw ? /^(bold|bolder|[6-9]00)/.test(fw) : tag === 'B' || tag === 'STRONG'
  const fs = prop('font-style')
  const italic = fs ? /^(italic|oblique)/.test(fs) : tag === 'EM' || tag === 'I'
  const td = prop('text-decoration-line') || prop('text-decoration')
  const underline = td ? /underline/.test(td) : tag === 'U'
  return { bold, italic, underline }
}

/** Build a nested <strong>/<em>/<u> wrapper chain; at least one flag is set. */
function buildInlineWrapper(doc: Document, flags: PasteFlags): Element {
  const chain: string[] = []
  if (flags.bold) chain.push('strong')
  if (flags.italic) chain.push('em')
  if (flags.underline) chain.push('u')
  const outer = doc.createElement(chain[0])
  let cur = outer
  for (const t of chain.slice(1)) {
    const next = doc.createElement(t)
    cur.appendChild(next)
    cur = next
  }
  return outer
}

function innermost(el: Element): Element {
  let cur = el
  while (cur.firstElementChild) cur = cur.firstElementChild
  return cur
}

function unwrapElement(el: Element): void {
  const parent = el.parentNode
  if (!parent) return
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  parent.removeChild(el)
}

/**
 * Wrap contiguous runs of inline/text children into <p> so a container can
 * be unwrapped without merging its stray text into the surrounding flow.
 * Runs with no visible content are dropped.
 */
function blockifyChildren(el: Element): void {
  const doc = el.ownerDocument
  let run: Node[] = []
  const flush = (before: Node | null) => {
    if (!run.length) return
    const hasContent = run.some((n) =>
      (n.textContent || '').replace(NBSP_RE, ' ').trim().length > 0 ||
      (n.nodeType === 1 && ((n as Element).tagName === 'BR' || (n as Element).querySelector('br'))))
    if (hasContent) {
      const p = doc.createElement('p')
      for (const n of run) p.appendChild(n)
      el.insertBefore(p, before)
    } else {
      for (const n of run) n.parentNode?.removeChild(n)
    }
    run = []
  }
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1 && PASTE_BLOCKISH.has((child as Element).tagName)) flush(child)
    else run.push(child)
  }
  flush(null)
}

/**
 * Bottom-up structural normalisation of pasted markup. Children are handled
 * before their parent, so by the time a container is processed its block
 * descendants have already been reduced to <p>/<ul>/<ol>.
 */
function normalizePasted(el: Element): void {
  for (const child of Array.from(el.children)) normalizePasted(child)

  const doc = el.ownerDocument
  const tag = el.tagName

  if (tag === 'BR' || tag === 'UL' || tag === 'OL') return
  if (tag === 'TD' || tag === 'TH') return // joined by the TR handler below

  const flags = effectiveInlineFlags(el)
  const anyFlag = flags.bold || flags.italic || flags.underline

  if (/^H[1-6]$/.test(tag)) {
    // Headings aren't in the vocabulary — keep the emphasis as a bold paragraph.
    const p = doc.createElement('p')
    const strong = doc.createElement('strong')
    while (el.firstChild) strong.appendChild(el.firstChild)
    p.appendChild(strong)
    el.replaceWith(p)
    return
  }
  if (tag === 'TR') {
    const p = doc.createElement('p')
    let first = true
    for (const cell of Array.from(el.children)) {
      if (!(cell.textContent || '').replace(NBSP_RE, ' ').trim()) continue
      if (!first) p.appendChild(doc.createTextNode(' '))
      while (cell.firstChild) p.appendChild(cell.firstChild)
      first = false
    }
    el.replaceWith(p)
    return
  }
  if (tag === 'P' || tag === 'LI') {
    if (anyFlag) {
      const wrap = buildInlineWrapper(doc, flags)
      const inner = innermost(wrap)
      while (el.firstChild) inner.appendChild(el.firstChild)
      el.appendChild(wrap)
    }
    return
  }
  if (PASTE_BLOCK_CONTAINERS.has(tag)) {
    blockifyChildren(el)
    unwrapElement(el)
    return
  }

  // Inline or unknown element: rebuild purely from the computed flags. This
  // also normalises <b> → <strong> and drops negated wrappers (Google Docs).
  if (anyFlag) {
    const wrap = buildInlineWrapper(doc, flags)
    const inner = innermost(wrap)
    while (el.firstChild) inner.appendChild(el.firstChild)
    el.replaceWith(wrap)
  } else {
    unwrapElement(el)
  }
}

/** `&nbsp;` → space and collapse whitespace runs, mirroring what CSS renders. */
function normalizeWhitespace(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      const t = child as Text
      t.data = t.data.replace(NBSP_RE, ' ').replace(/[ \t\r\n]+/g, ' ')
    } else if (child.nodeType === 1) {
      normalizeWhitespace(child)
    }
  }
}

/**
 * Word doesn't paste real lists — each item is a
 * `<p class="MsoListParagraph" style="mso-list:…">` with the marker glyph in
 * a `mso-list:Ignore` span. Convert consecutive runs of those paragraphs to
 * <ul>/<ol> (ordered when the first marker reads like "1." / "1)").
 * Best-effort heuristic; anything it misses degrades to plain paragraphs.
 */
function convertWordLists(root: Element): void {
  const doc = root.ownerDocument
  const isWordListP = (el: Element | null): el is Element =>
    !!el && el.tagName === 'P' && (
      /msolistparagraph/i.test(el.getAttribute('class') || '') ||
      /mso-list\s*:/i.test(el.getAttribute('style') || ''))
  const done = new Set<Element>()
  for (const start of Array.from(root.querySelectorAll('p'))) {
    if (done.has(start) || !isWordListP(start)) continue
    const group: Element[] = []
    let cur: Element | null = start
    while (isWordListP(cur)) {
      group.push(cur)
      done.add(cur)
      cur = cur.nextElementSibling
    }
    let ordered = false
    for (const p of group) {
      const marker = findWordListMarker(p)
      if (marker) {
        if (p === group[0]) ordered = /^\s*\d+[.)]/.test(marker.textContent || '')
        marker.remove()
      }
    }
    const list = doc.createElement(ordered ? 'ol' : 'ul')
    start.parentNode?.insertBefore(list, start)
    for (const p of group) {
      const li = doc.createElement('li')
      while (p.firstChild) li.appendChild(p.firstChild)
      list.appendChild(li)
      p.remove()
    }
  }
}

function findWordListMarker(p: Element): Element | null {
  for (const span of Array.from(p.querySelectorAll('span'))) {
    if (/mso-list\s*:\s*ignore/i.test(span.getAttribute('style') || '')) return span
  }
  return null
}

/**
 * Extract plain text from a rich-text HTML string. Used wherever the UI shows
 * a preview (EditorCard preview pane, completeness check) — those contexts
 * shouldn't render markup.
 *
 * Lists render with "• " / "1. " prefixes so the preview still reads as a
 * list, since whitespace alone would lose the structure.
 */
export function richToPlain(html: string): string {
  if (!html) return ''
  if (!hasMarkup(html)) return html  // fast path for plain-text values
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')
  if (!root) return ''
  // Collapse only space runs that follow a non-space, so the line-leading
  // indentation of nested list items survives.
  return nodeText(root)
    .replace(/(\S)[ \t]{2,}/g, '$1 ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function nodeText(node: Node): string {
  if (node.nodeType === 3 /* text */) {
    // Whitespace runs (incl. source newlines) render as one space in HTML.
    return (node.textContent || '').replace(/[ \t\r\n]+/g, ' ')
  }
  if (node.nodeType !== 1 /* element */) return ''
  const el = node as Element
  const tag = el.tagName
  if (tag === 'BR') return '\n'
  if (tag === 'LI') {
    // Separate the item's own inline content from nested sub-lists so the
    // sub-items land on their own (deeper-indented) lines.
    let inline = ''
    let nested = ''
    for (const child of Array.from(el.childNodes)) {
      const t = child.nodeType === 1 ? (child as Element).tagName : ''
      if (t === 'UL' || t === 'OL') nested += nodeText(child)
      else inline += nodeText(child)
    }
    const parent = el.parentElement
    let depth = 0
    for (let anc = parent?.parentElement; anc; anc = anc.parentElement) {
      if (anc.tagName === 'UL' || anc.tagName === 'OL') depth++
    }
    const pad = '  '.repeat(depth)
    if (parent?.tagName === 'OL') {
      const items = Array.from(parent.children).filter((c) => c.tagName === 'LI')
      return `${pad}${items.indexOf(el) + 1}. ${inline.trim()}\n${nested}`
    }
    return `${pad}• ${inline.trim()}\n${nested}`
  }
  if (tag === 'P' || tag === 'UL' || tag === 'OL') {
    return childrenText(el) + (tag === 'P' ? '\n' : '')
  }
  return childrenText(el)
}

function childrenText(el: Element): string {
  let out = ''
  for (const child of Array.from(el.childNodes)) out += nodeText(child)
  return out
}

/**
 * Cheap probe: does this string contain *any* HTML markup we care about?
 * Used by callers (HTML export, plain extractor) to skip work for the
 * overwhelmingly common plain-text case (imported CVpartner data, etc.).
 */
export function hasMarkup(s: string): boolean {
  if (!s) return false
  return /<\/?(p|br|strong|b|em|i|u|ul|ol|li)\b/i.test(s)
}

/**
 * Render a rich-text value into safe HTML for inclusion in the printable
 * preview / PDF output. If the input has no markup, the caller-supplied
 * `escapePlain` is used to keep escape-at-render semantics for raw text.
 *
 * NEVER call this on a value of unknown shape — always go through here so the
 * allowlist is enforced even on the export path.
 */
export function renderRichHtml(value: string, escapePlain: (s: string) => string): string {
  if (!value) return ''
  if (!hasMarkup(value)) return escapePlain(value)
  return sanitizeRich(value)
}

// ─── DOCX helpers ────────────────────────────────────────────────────────────

/**
 * Inline run with formatting flags. The DOCX exporter turns this into a
 * `TextRun`. Block structure (paragraph / list) is described by RichBlock
 * below; runs only carry inline state.
 */
export interface RichRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

export type RichBlock =
  | { kind: 'paragraph'; runs: RichRun[] }
  | { kind: 'list-item'; ordered: boolean; level: number; index: number; runs: RichRun[] }

/**
 * Parse a rich-text HTML string into a structured block list the DOCX
 * exporter can consume. Plain-text input becomes a single paragraph.
 *
 * Nested lists are flattened: the `level` field carries depth so the DOCX
 * exporter can indent. CVpartner rarely produces nested lists so this is
 * good enough — the alternative would be docx's numbering instances and a
 * lot of plumbing.
 */
export function parseRichBlocks(html: string): RichBlock[] {
  if (!html) return []
  if (!hasMarkup(html)) {
    return [{ kind: 'paragraph', runs: [{ text: html }] }]
  }
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')
  if (!root) return []
  const out: RichBlock[] = []
  walkBlocks(root, out, { bold: false, italic: false, underline: false }, { listKind: null, level: 0, counter: 0 })
  // Coalesce consecutive paragraphs with empty runs (markup-only artefacts).
  return out.filter((b) => b.runs.some((r) => r.text.length))
}

interface InlineState { bold: boolean; italic: boolean; underline: boolean }
interface ListCtx { listKind: 'ul' | 'ol' | null; level: number; counter: number }

function walkBlocks(node: Element, out: RichBlock[], inline: InlineState, list: ListCtx): void {
  let currentRuns: RichRun[] = []
  const flushParagraph = () => {
    if (currentRuns.length) {
      out.push({ kind: 'paragraph', runs: currentRuns })
      currentRuns = []
    }
  }

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      const text = (child.textContent || '').replace(/\s+/g, ' ')
      if (text) currentRuns.push({ text, ...activeFlags(inline) })
      continue
    }
    if (child.nodeType !== 1) continue
    const el = child as Element
    const tag = el.tagName
    if (tag === 'BR') {
      currentRuns.push({ text: '\n', ...activeFlags(inline) })
      continue
    }
    if (tag === 'STRONG' || tag === 'B' || tag === 'EM' || tag === 'I' || tag === 'U') {
      const flagged: InlineState = {
        bold: inline.bold || tag === 'STRONG' || tag === 'B',
        italic: inline.italic || tag === 'EM' || tag === 'I',
        underline: inline.underline || tag === 'U',
      }
      const runs = collectInlineRuns(el, flagged)
      currentRuns.push(...runs)
      continue
    }
    if (tag === 'P') {
      flushParagraph()
      const runs = collectInlineRuns(el, inline)
      if (runs.length) out.push({ kind: 'paragraph', runs })
      continue
    }
    if (tag === 'UL' || tag === 'OL') {
      flushParagraph()
      walkBlocks(el, out, inline, {
        listKind: tag === 'UL' ? 'ul' : 'ol',
        level: list.listKind ? list.level + 1 : 0,
        counter: 0,
      })
      continue
    }
    if (tag === 'LI') {
      if (!list.listKind) continue  // stray <li>
      list.counter += 1
      const runs = collectInlineRuns(el, inline)
      if (runs.length) {
        out.push({
          kind: 'list-item',
          ordered: list.listKind === 'ol',
          level: list.level,
          index: list.counter,
          runs,
        })
      }
      // A sub-list nested inside the item (li > ul) — emit as deeper items.
      // (A sub-list nested as a sibling, ul > ul, hits the branch above.)
      for (const sub of Array.from(el.children)) {
        if (sub.tagName === 'UL' || sub.tagName === 'OL') {
          walkBlocks(sub, out, inline, {
            listKind: sub.tagName === 'UL' ? 'ul' : 'ol',
            level: list.level + 1,
            counter: 0,
          })
        }
      }
      continue
    }
    // Unknown / unhandled — descend, treating it as transparent.
    walkBlocks(el, out, inline, list)
  }

  flushParagraph()
}

/**
 * Walk an inline element gathering runs but ignoring block boundaries.
 * Block-level children (p, ul, ol, li) inside an inline tag are vanishingly
 * rare in our domain; if they appear we treat them as transparent text.
 */
function collectInlineRuns(node: Element, inline: InlineState): RichRun[] {
  const out: RichRun[] = []
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      const text = (child.textContent || '').replace(/\s+/g, ' ')
      if (text) out.push({ text, ...activeFlags(inline) })
      continue
    }
    if (child.nodeType !== 1) continue
    const el = child as Element
    const tag = el.tagName
    if (tag === 'BR') {
      out.push({ text: '\n', ...activeFlags(inline) })
      continue
    }
    // Nested lists are blocks — the LI branch in walkBlocks emits them as
    // deeper list items; duplicating their text inline would double it.
    if (tag === 'UL' || tag === 'OL') continue
    const next: InlineState = {
      bold: inline.bold || tag === 'STRONG' || tag === 'B',
      italic: inline.italic || tag === 'EM' || tag === 'I',
      underline: inline.underline || tag === 'U',
    }
    out.push(...collectInlineRuns(el, next))
  }
  return out
}

function activeFlags(inline: InlineState): Partial<RichRun> {
  const flags: Partial<RichRun> = {}
  if (inline.bold)      flags.bold = true
  if (inline.italic)    flags.italic = true
  if (inline.underline) flags.underline = true
  return flags
}
