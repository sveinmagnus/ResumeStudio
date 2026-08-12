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
 * ONE KIND OF LINE BREAK (see `blockify`). A value can arrive carrying three
 * different encodings of "new line" — a `<p>` boundary, a `<br>`, and a raw
 * newline in a text node (what every plain-text import carries, and what a
 * `white-space: pre-wrap` editor emits). Left alone they render differently per
 * target: the `<p>` gets paragraph spacing, the `<br>` a tight break, and a raw
 * newline becomes a break in the editor and in PDF but a plain SPACE in the HTML
 * preview and in Word — invisible in the editor, different in the export. So
 * sanitising CANONICALISES: outside a list item every break becomes a `<p>`
 * boundary, and the paragraph gap is one shared value (`PARA_GAP_LINES`) across
 * all four renderers.
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
 * The gap between paragraphs, as a fraction of one line box. 0.5 gives the
 * one-and-a-half line spacing the CV style asks for (one line of text plus
 * half a line of air). ONE number, consumed by the editor, the HTML preview,
 * the DOCX exporter and the PDF exporter — change it here and all four move
 * together.
 */
export const PARA_GAP_LINES = 0.5

/** The paragraph gap in CSS `em`, for a container with this line height. */
export function paraGapEm(lineHeight: number): number {
  return Math.round(PARA_GAP_LINES * lineHeight * 1000) / 1000
}

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
  normalizeBreaks(root)
  blockify(root)
  return root.innerHTML
}

/** Inline tags that survive a paragraph split (rebuilt around each half). */
const INLINE_TAGS = new Set(['STRONG', 'B', 'EM', 'I', 'U'])

/**
 * Canonicalise the block structure so a value encodes "new line" exactly ONE
 * way. Afterwards a sanitised value satisfies:
 *
 *  - the root holds only `<p>`, `<ul>` and `<ol>` — no loose text, no stray
 *    `<br>`, no raw newlines;
 *  - a `<p>` holds only inline content — every `<br>` and every raw newline
 *    inside it became a paragraph boundary, with the inline formatting
 *    (`<strong>`/`<em>`/`<u>`) rebuilt around each half;
 *  - inside a list item a break stays a `<br>` (splitting there would invent a
 *    bullet the user never wrote) and every renderer draws it as a real break.
 *
 * A whitespace-only text node is never a break — that's the newline in
 * pretty-printed markup (`</p>\n<p>`), which HTML has always rendered as
 * nothing. Only a newline sitting next to real text is one.
 *
 * Idempotent: canonical input rebuilds to itself, which the editor's
 * repaint guard depends on.
 */
function blockify(root: Element): void {
  const doc = root.ownerDocument
  const out: Node[] = []
  let loose: Node[] = []

  const flushLoose = () => {
    if (!loose.length) return
    const holder = doc.createElement('p')
    for (const n of loose) holder.appendChild(n)
    out.push(...splitIntoParagraphs(holder, doc))
    loose = []
  }

  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 1) {
      const el = node as Element
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        flushLoose()
        newlinesToBreaks(el)
        // The breaks we just introduced go through the same tidy-up as the
        // ones that arrived as markup (edge breaks dropped, runs collapsed).
        normalizeBreaks(el)
        out.push(el)
        continue
      }
      if (el.tagName === 'P') {
        flushLoose()
        out.push(...splitIntoParagraphs(el, doc))
        continue
      }
    }
    loose.push(node)
  }
  flushLoose()

  while (root.firstChild) root.removeChild(root.firstChild)
  for (const n of out) root.appendChild(n)
}

/**
 * Flatten one block's inline content into a list of `<p>`s, breaking at every
 * `<br>` and every newline that sits next to real text. The chain of open
 * inline elements is cloned into each new paragraph, so a break in the middle
 * of a bold run leaves both halves bold.
 */
function splitIntoParagraphs(source: Element, doc: Document): Element[] {
  const paras: Element[] = []
  let cur = doc.createElement('p')
  paras.push(cur)
  // The inline elements currently open, outermost first; the last one is where
  // content lands.
  let open: Element[] = []
  const tip = (): Element => (open.length ? open[open.length - 1] : cur)

  const startNew = () => {
    cur = doc.createElement('p')
    paras.push(cur)
    let parent: Element = cur
    const rebuilt: Element[] = []
    for (const el of open) {
      const clone = doc.createElement(el.tagName.toLowerCase())
      parent.appendChild(clone)
      parent = clone
      rebuilt.push(clone)
    }
    open = rebuilt
  }

  const visit = (node: Node): void => {
    if (node.nodeType === 3 /* text */) {
      const text = node.textContent || ''
      if (!text.trim()) {
        // Layout whitespace between tags — carries no break.
        tip().appendChild(doc.createTextNode(text))
        return
      }
      const parts = text.replace(/\r\n?/g, '\n').split('\n')
      parts.forEach((part, i) => {
        if (i) startNew()
        if (part) tip().appendChild(doc.createTextNode(part))
      })
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    if (el.tagName === 'BR') {
      startNew()
      return
    }
    if (INLINE_TAGS.has(el.tagName)) {
      const clone = doc.createElement(el.tagName.toLowerCase())
      tip().appendChild(clone)
      open.push(clone)
      for (const child of Array.from(el.childNodes)) visit(child)
      open.pop()
      return
    }
    // A list (or anything else) nested inside a paragraph: descend through it.
    // Invalid nesting like this only reaches us from imported markup.
    for (const child of Array.from(el.childNodes)) visit(child)
  }

  for (const child of Array.from(source.childNodes)) visit(child)

  const kept = paras.filter((p) => (p.textContent || '').trim().length > 0)
  for (const p of kept) {
    pruneEmptyInline(p)
    trimEdgeWhitespace(p)
  }
  return kept
}

/** Drop inline wrappers the split left with nothing in them. */
function pruneEmptyInline(el: Element): void {
  for (const child of Array.from(el.children)) {
    pruneEmptyInline(child)
    if (INLINE_TAGS.has(child.tagName) && !(child.textContent || '').trim()) child.remove()
  }
}

/** Trim the leading/trailing whitespace a split can leave at a paragraph edge. */
function trimEdgeWhitespace(el: Element): void {
  const texts: Text[] = []
  const collect = (n: Node) => {
    for (const child of Array.from(n.childNodes)) {
      if (child.nodeType === 3) texts.push(child as Text)
      else if (child.nodeType === 1) collect(child)
    }
  }
  collect(el)
  if (!texts.length) return
  texts[0].data = texts[0].data.replace(/^\s+/, '')
  texts[texts.length - 1].data = texts[texts.length - 1].data.replace(/\s+$/, '')
}

/**
 * Inside a list, a raw newline next to real text becomes a `<br>` — the one
 * place a break is not a paragraph boundary. Whitespace-only text nodes (the
 * indentation of pretty-printed markup) are left alone.
 */
function newlinesToBreaks(root: Element): void {
  const doc = root.ownerDocument
  const walkText = (node: Node) => {
    const inList = node.nodeType === 1 && ((node as Element).tagName === 'UL' || (node as Element).tagName === 'OL')
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 1) { walkText(child); continue }
      if (child.nodeType !== 3) continue
      const text = (child.textContent || '').replace(/\r\n?/g, '\n')
      // Layout whitespace BETWEEN list items renders as nothing — drop it so
      // the canonical output doesn't carry the source's indentation.
      if (inList && !text.trim()) { child.parentNode?.removeChild(child); continue }
      if (!text.trim() || !text.includes('\n')) continue
      const frag = doc.createDocumentFragment()
      text.split('\n').forEach((part, i) => {
        if (i) frag.appendChild(doc.createElement('br'))
        if (part) frag.appendChild(doc.createTextNode(part))
      })
      child.parentNode?.replaceChild(frag, child)
    }
  }
  walkText(root)
}

/**
 * Collapse the "oversized gap" artifacts that Word / Google Docs / external
 * translators leave behind — the ones that survived the tag allowlist because
 * `<p>` and `<br>` are legal:
 *
 *  - runs of consecutive `<br>` (ignoring whitespace-only text between them)
 *    collapse to a single `<br>`;
 *  - a leading / trailing `<br>` inside a `<p>` / `<li>` is dropped (it only
 *    adds a blank line at the block's edge);
 *  - a paragraph whose only content is whitespace and/or `<br>` — a Word "blank
 *    line" between paragraphs — is removed entirely (paragraph spacing is the
 *    `<p>` margin, not an empty paragraph).
 *
 * Runs on every write AND on the editor's mount render boundary, so it also
 * normalises values stored before this existed on their next edit/save. While a
 * field is focused the editor keeps a just-typed trailing empty paragraph in the
 * DOM (it's stripped only from storage), so creating a new line still works.
 */
function normalizeBreaks(root: Element): void {
  const isBlank = (n: Node | null): boolean =>
    !!n && n.nodeType === 3 && !(n.textContent || '').trim()
  const isBr = (n: Node | null): boolean =>
    !!n && n.nodeType === 1 && (n as Element).tagName === 'BR'

  // 1. Collapse consecutive <br> (whitespace-only text nodes don't break a run).
  for (const br of Array.from(root.querySelectorAll('br'))) {
    let next = br.nextSibling
    while (isBlank(next)) next = next!.nextSibling
    if (isBr(next)) br.remove()
  }

  // 2. Strip leading/trailing <br> (and the blank text around them) inside
  //    every <p>/<li>, where they only draw an empty edge line.
  for (const block of Array.from(root.querySelectorAll('p,li'))) {
    while (block.lastChild && (isBr(block.lastChild) || isBlank(block.lastChild))) {
      block.removeChild(block.lastChild)
    }
    while (block.firstChild && (isBr(block.firstChild) || isBlank(block.firstChild))) {
      block.removeChild(block.firstChild)
    }
  }

  // 3. Remove paragraphs left with no meaningful content (a Word blank line).
  for (const p of Array.from(root.querySelectorAll('p'))) {
    if (!(p.textContent || '').trim()) p.remove()
  }
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

  // sanitizeRich re-parses and canonicalises the block structure (invalid
  // nesting we may have built auto-corrects there, empty shells are swept).
  const clean = sanitizeRich(root.innerHTML)
  // A one-paragraph paste splices into the caret's paragraph rather than
  // splitting it in two — mirroring plainToRichHtml's single-line rule.
  return unwrapSingleParagraph(clean)
}

/** `<p>x</p>` → `x` when that's the whole value; anything else is untouched. */
function unwrapSingleParagraph(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')
  if (!root) return html
  const only = root.childNodes.length === 1 ? root.firstChild : null
  if (only && only.nodeType === 1 && (only as Element).tagName === 'P') return (only as Element).innerHTML
  return html
}

/**
 * Split plain text into paragraphs. EVERY newline is a paragraph break — a
 * blank line and a single newline mean the same thing, because the user cannot
 * see which one a stored value holds. This is the plain-text twin of
 * `blockify`, and the one rule every plain-text source (CVpartner and LinkedIn
 * imports, AI/bulk imports, translation drafts) is read with.
 */
export function plainParagraphs(text: string): string[] {
  if (!text) return []
  return text.replace(/\r\n?/g, '\n').split('\n').map((p) => p.trim()).filter(Boolean)
}

/**
 * Convert plain clipboard text into the storage shape: every line becomes a
 * paragraph. Single-line text is returned escaped but unwrapped so it splices
 * into the caret's paragraph instead of splitting it.
 */
export function plainToRichHtml(text: string): string {
  if (!text) return ''
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const paras = plainParagraphs(text)
  if (!paras.length) return ''
  if (paras.length === 1 && !/\n/.test(text)) return esc(text)
  return paras.map((p) => `<p>${esc(p)}</p>`).join('')
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
  // Cells are joined into one line by the TR handler below.
  if (tag === 'TD' || tag === 'TH') return

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
  // Fast path: a plain-text value has nothing to sanitise.
  if (!hasMarkup(html)) return html
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
  // Plain text is paragraph-split on the way out too, so an imported CV whose
  // descriptions are newline-separated reads the same as one typed in the
  // editor. Without this the newlines collapsed to spaces and the whole
  // description arrived as one block of running text.
  if (!hasMarkup(value)) {
    return plainParagraphs(value).map((p) => `<p>${escapePlain(p)}</p>`).join('')
  }
  return sanitizeRich(value)
}

/**
 * Render a rich value for a context that is ITSELF one line — a bullet in the
 * points list, where a block `<p>` would push the text below its label. The
 * paragraphs are joined with a space; lists keep their own markup.
 */
export function renderRichInlineHtml(value: string, escapePlain: (s: string) => string): string {
  if (!value) return ''
  if (!hasMarkup(value)) return plainParagraphs(value).map(escapePlain).join(' ')
  const doc = new DOMParser().parseFromString(`<div id="root">${sanitizeRich(value)}</div>`, 'text/html')
  const root = doc.getElementById('root')
  if (!root) return ''
  return Array.from(root.children)
    .map((el) => (el.tagName === 'P' ? el.innerHTML : el.outerHTML))
    .filter(Boolean)
    .join(' ')
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
    // Plain text splits on newlines, exactly as the HTML path does — otherwise
    // a Word/PDF export ran the lines together while the preview showed them
    // apart.
    return plainParagraphs(html).map((text) => ({ kind: 'paragraph', runs: [{ text }] }))
  }
  // Canonicalise FIRST. A value written before blockify existed still holds
  // <br>s and raw newlines, and walking those directly gave Word and the PDF a
  // different block structure than the HTML preview built from the same value.
  const canonical = sanitizeRich(html)
  const doc = new DOMParser().parseFromString(`<div id="root">${canonical}</div>`, 'text/html')
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
      // A stray <li> with no enclosing list.
      if (!list.listKind) continue
      // Loose text pasted straight into a <ul> (before its first <li>) is
      // sitting in `currentRuns`; without this it would be flushed at the END
      // of the list and read after the items the author wrote it above.
      flushParagraph()
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
