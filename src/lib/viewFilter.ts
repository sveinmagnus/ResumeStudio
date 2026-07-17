import type {
  ResumeStore, ResumeView, ViewSection, LocalizedString, SectionDetail,
} from '../types'
import { SECTIONS, localizedSectionHeading } from './sections'
import { resolve, bcp47 } from './locales'
import { SECTION_CATALOG, type AnyItem, type CatalogCtx, type SummaryView, type SummaryPartKey } from './sectionCatalog'
import type { SummaryLayout } from '../types'
import { skillMatrixRows, fmtLastUsed, fmtProficiency } from './skillMatrix'
import { xs, fmtYears } from './exportStrings'
import { showcaseGroups } from './showcase'
import { renderRichHtml } from './richText'
import { deriveTokens, resolveSectionStyle, sectionHeadingText, kqVisibility, bulletGlyph, withDefaults, withResolvedFonts, resolveFontCss, type ResolvedSectionStyle, type StyleTokens } from './viewStyle'
import type { GlobalFonts } from './fonts'
import { sortItems } from './sectionSort'
import { SECTION_ICON_INNER } from '../generated/sectionIcons'
import { withHeaderDefaults, withFooterDefaults, buildHeaderLines, buildCopyrightLine, footerLines } from './viewHeader'

/**
 * Build a section's `<h2>` heading, optionally prefixed with the section's
 * icon (the same lucide glyph as the app sidebar). Icon markup comes from a
 * generated static map — never user data — so it's safe to inline unescaped.
 */
function sectionHeadingHtml(resolved: ResolvedSectionStyle, key: string, iconName: string, locale: string): string {
  if (resolved.hide_heading) return ''
  const text = escapeHtml(sectionHeadingText(resolved, localizedSectionHeading(key, locale), locale))
  const inner = resolved.show_icon ? (SECTION_ICON_INNER[iconName] ?? '') : ''
  const icon = inner
    ? `<svg class="ve-sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
    : ''
  return `<h2>${icon}${text}</h2>`
}

// ─── Section helpers ──────────────────────────────────────────────────────────

/**
 * Sections that can appear in an exported view. Excludes:
 *  - 'views' (the export config itself), and
 *  - the reusable registries 'skills' / 'roles' — these are structural data
 *    referenced by other sections, never rendered as a section of their own.
 */
const NON_EXPORT_KEYS = new Set(['views', 'skills', 'roles'])

export function isExportableSection(s: { key: string; storeKey?: unknown }): boolean {
  return !!s.storeKey && !NON_EXPORT_KEYS.has(s.key)
}

/**
 * Default detail for a section when a view doesn't explicitly list it. Most
 * sections default to 'full'; the synthetic sections (`promoted_projects`,
 * `skill_matrix`) default to 'off' so existing and new views aren't changed
 * until the user enables them.
 */
export function defaultViewDetail(key: string): SectionDetail {
  return key === 'promoted_projects' || key === 'skill_matrix' ? 'off' : 'full'
}

/** The renderer/title key a section uses — synthetics reuse their source registry's titles. */
function renderKeyFor(key: string): string {
  if (key === 'promoted_projects') return 'projects'
  // The Skill Matrix is toggled by CATEGORY in the view editor (not individual
  // skills), so its item list titles resolve through the category descriptor.
  if (key === 'skill_matrix') return 'technology_categories'
  return key
}

/**
 * Source items for the synthetic "Promoted Projects" view section: the starred,
 * enabled, non-excluded projects. Independent of the regular Projects section's
 * detail, so a view can show Projects='off' + Promoted='full' for a clean,
 * promoted-only CV. Shared by both render paths and the view editor's item list.
 */
export function promotedProjectItems(store: ResumeStore, view: ResumeView): unknown[] {
  const excluded = new Set(view.excluded_item_ids)
  const items = store.projects.filter(
    (p) => !p.disabled && !excluded.has(p.id) && p.starred,
  )
  // Promoted projects bypass applyView (they derive from the raw store), so
  // the view-wide anonymization must be applied here too.
  return view.force_anonymized ? items.map((p) => ({ ...p, use_anonymized: true })) : items
}

/**
 * Redact a person's name to initials: "Kari Nordmann" → "K. N.". Used for
 * references on force-anonymized views — enough to show a reference exists
 * without identifying anyone. Empty input stays empty.
 */
export function redactPersonName(name: string | null | undefined): string {
  if (!name) return ''
  return name
    .trim()
    .split(/\s+/)
    .map((part) => `${part.charAt(0).toUpperCase()}.`)
    .join(' ')
}

/** Build default ViewSection[] for a new view — exportable sections in master order. */
export function buildViewSections(): ViewSection[] {
  return SECTIONS
    .filter(isExportableSection)
    .map((s, i) => ({ key: s.key, detail: defaultViewDetail(s.key), sort_order: i }))
}

/**
 * Ensure a view's section list covers every exportable section. Views created
 * before a section existed won't list it; this fills the gaps (preserving the
 * user's existing order, appending new sections at the end with their default
 * detail) so the view editor can configure them. Pure — returns a new array.
 */
export function normalizeViewSections(stored: ViewSection[]): ViewSection[] {
  const present = new Set(stored.map((s) => s.key))
  const ordered = [...stored].sort((a, b) => a.sort_order - b.sort_order)
  const missing = SECTIONS
    .filter(isExportableSection)
    .filter((s) => !present.has(s.key))
    .map((s) => ({ key: s.key, detail: defaultViewDetail(s.key), sort_order: 0 }))
  return [...ordered, ...missing].map((s, i) => ({ ...s, sort_order: i }))
}

/** Reorder sections within a view, swapping the target up or down. */
export function reorderViewSections(sections: ViewSection[], key: string, dir: 'up' | 'down'): ViewSection[] {
  const sorted = [...sections].sort((a, b) => a.sort_order - b.sort_order)
  const idx = sorted.findIndex((s) => s.key === key)
  const swap = dir === 'up' ? idx - 1 : idx + 1
  if (idx === -1 || swap < 0 || swap >= sorted.length) return sections
  ;[sorted[idx], sorted[swap]] = [sorted[swap], sorted[idx]]
  return sorted.map((s, i) => ({ ...s, sort_order: i }))
}

// ─── Item display helpers ─────────────────────────────────────────────────────
// Section knowledge lives in lib/sectionCatalog.ts (roadmap A5); these are
// thin reads of the catalog so the View editor and both render paths agree.

export function getItemTitle(sectionKey: string, item: unknown, locale: string): string {
  const it = item as AnyItem
  const desc = SECTION_CATALOG[renderKeyFor(sectionKey)]
  return desc ? desc.title(it, locale) : String(it.id || 'Item')
}

export function getItemSubtitle(sectionKey: string, item: unknown, locale: string): string {
  const desc = SECTION_CATALOG[renderKeyFor(sectionKey)]
  return desc?.subtitle?.(item as AnyItem, locale) ?? ''
}

// ─── View detail / section helpers ──────────────────────────────────────────

/** Resolve a section's detail level — defaults to 'full' if the view doesn't list it. */
function sectionDetail(view: ResumeView, key: string): SectionDetail {
  return view.sections.find((s) => s.key === key)?.detail ?? 'full'
}

/**
 * Whether a section shows only starred items: its own override wins, else the
 * view-wide `starred_only`. An explicit `false` on the section is a real
 * choice ("every course, even in a starred-only view"), so it must beat the
 * view default — hence `??` and not `||`.
 */
export function sectionStarredOnly(view: ResumeView, key: string): boolean {
  return view.sections.find((s) => s.key === key)?.style?.starred_only ?? !!view.starred_only
}

// ─── View filter ──────────────────────────────────────────────────────────────

/**
 * Return a copy of the store with disabled / excluded items removed and any
 * section whose detail is 'off' emptied. Items in 'summary' sections are
 * KEPT — the renderer decides how to display them.
 */
export function applyView(store: ResumeStore, view: ResumeView): ResumeStore {
  const excluded = new Set(view.excluded_item_ids)
  const filtered = { ...store }

  for (const sec of SECTIONS) {
    if (!sec.storeKey || sec.key === 'views') continue
    // Virtual sections (promoted_projects) don't own a store array — they're
    // derived at render time, so skip them here to avoid clobbering the real
    // section that shares their storeKey.
    if (sec.virtual) continue
    const detail = sectionDetail(view, sec.key)
    const starredOnly = sectionStarredOnly(view, sec.key)
    const items = store[sec.storeKey] as Array<{ id: string; disabled?: boolean; starred?: boolean }>

    if (detail === 'off') {
      ;(filtered as Record<string, unknown>)[sec.storeKey] = []
    } else {
      ;(filtered as Record<string, unknown>)[sec.storeKey] = items.filter((item) => {
        if (item.disabled) return false
        if (excluded.has(item.id)) return false
        if (starredOnly && !item.starred) return false
        return true
      })
    }
  }

  // View-wide anonymization (F5): rewrite the filtered COPIES so both render
  // paths (and the live preview) pick it up without per-renderer logic. The
  // catalog's projectCustomer() never falls back to the real name, so a
  // project without an alias renders its description instead of leaking.
  if (view.force_anonymized) {
    filtered.projects = filtered.projects.map((p) => ({ ...p, use_anonymized: true }))
    filtered.references = filtered.references.map((r) => ({ ...r, name: redactPersonName(r.name) }))
  }

  return filtered
}

// ─── HTML export ─────────────────────────────────────────────────────────────

/**
 * Escape a string for safe interpolation into HTML text or attribute context.
 *
 * Why: every value rendered by buildViewHtml below comes from imported CV
 * data or user input. Without escaping, a name, description, or introduction
 * containing `<script>` runs in the same-origin preview iframe / print popup
 * — which would let a malicious imported file drive the API as the user (the
 * HttpOnly session cookie auto-authenticates same-origin requests) and read
 * the resume caches in localStorage. The generated document also carries a
 * restrictive CSP, but escape-at-render is the primary defence.
 */
export function escapeHtml(s: string | null | undefined): string {
  if (!s) return ''
  return String(s).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&#39;'
      default:  return c
    }
  })
}

/**
 * Guard: only embed images that are base64 data URLs of a known *raster*
 * format. The generated document's CSP allows `img-src 'self' data:`, so an
 * external http(s) URL is blocked regardless — and we never trust an arbitrary
 * attribute value.
 *
 * SECURITY: SVG is excluded deliberately. `data:image/svg+xml` can carry markup
 * /script; while a browser doesn't execute script in an SVG loaded via <img>
 * (and the CSP would block it), restricting to raster formats removes the
 * question entirely. Uploads are re-encoded to PNG/JPEG via canvas (lib/image),
 * so this never rejects a legitimately-uploaded photo or logo.
 */
export function isDataImage(src: string | null | undefined): src is string {
  return !!src && /^data:image\/(png|jpe?g|gif|bmp|webp)[;,]/i.test(src)
}

interface RenderCtx {
  locale: string
  detail: SectionDetail
  style: ResolvedSectionStyle
}

/**
 * Skills are either chips (default) or an inline italic comma list.
 * `names` are plain text from the catalog; escaping happens here.
 */
function renderTagsHtml(names: string[], style: ResolvedSectionStyle): string {
  if (!names.length) return ''
  if (style.tag_style === 'inline') {
    return `<div class="ve-tags-inline">${escapeHtml(names.join(', '))}</div>`
  }
  return `<div class="ve-tags">${names.map((n) => `<span class="ve-tag">${escapeHtml(n)}</span>`).join('')}</div>`
}

// ─── Summary item layout (ordering + tabulation) ─────────────────────────────
// The summary line is composed of three ordered slots — Title, Organization
// (role + org), Date (start/end or single date). A view's item-layout config
// picks the slot order; tabulate spreads each part into its own aligned column.

type Slot = 'title' | 'org' | 'date'

const LAYOUT_SLOTS: Record<SummaryLayout, Slot[]> = {
  'title-org-date': ['title', 'org', 'date'],
  'title-date-org': ['title', 'date', 'org'],
  'org-title-date': ['org', 'title', 'date'],
  'org-date-title': ['org', 'date', 'title'],
  'date-title-org': ['date', 'title', 'org'],
  'date-org-title': ['date', 'org', 'title'],
}

/** Which slot each part belongs to. */
const SLOT_OF: Record<SummaryPartKey, Slot> = {
  title: 'title', role: 'org', org: 'org', start: 'date', end: 'date', date: 'date',
}

/** Per-slot column order for tabulation (each key becomes its own column). */
const SLOT_KEYS: Record<Slot, SummaryPartKey[]> = {
  title: ['title'], org: ['role', 'org'], date: ['start', 'end', 'date'],
}

const slotsFor = (layout: SummaryLayout): Slot[] => LAYOUT_SLOTS[layout] ?? LAYOUT_SLOTS['title-org-date']

/**
 * Render a summary as a single free-flowing line, slots in the chosen order.
 * An optional `short` description is appended inline or placed on its own line
 * below (per `shortLine`).
 */
function renderSummaryInline(
  s: SummaryView, layout: SummaryLayout, short = '', shortLine: 'inline' | 'below' = 'below',
): string {
  const slots = slotsFor(layout)
  const groups = slots
    .map((slot) => ({
      slot,
      // Within a slot, distinct parts are joined with a middot — EXCEPT the
      // date slot, whose from/to dates read as a range and use a short dash.
      text: s.parts.filter((p) => SLOT_OF[p.key] === slot).map((p) => p.value)
        .filter(Boolean).join(slot === 'date' ? ' – ' : ' · '),
    }))
    .filter((g) => g.text)
  const shortEsc = short.trim() ? escapeHtml(short.trim()) : ''
  if (!groups.length && !shortEsc) return ''
  // Keyed off what actually RENDERED first, not the configured slot order: a
  // section with no dates (Languages) still leads with its title under the
  // date-first layout, and should read "Norwegian — Native", not "· Native".
  const titleFirst = groups[0]?.slot === 'title'
  let html = groups
    .map((g, i) => {
      const inner = g.slot === 'title'
        ? `<strong>${escapeHtml(g.text)}</strong>`
        : `<span class="ve-meta-inline">${escapeHtml(g.text)}</span>`
      if (i === 0) return inner
      // Keep the classic "Title — meta" / "Category: skills" look when the title
      // leads; otherwise a neutral middot between reordered slots.
      const joiner = i === 1 && titleFirst ? (s.sep === ':' ? ': ' : ' — ') : ' · '
      return `${joiner}${inner}`
    })
    .join('')
  let below = ''
  if (shortEsc) {
    const chunk = `<span class="ve-summary-short">${shortEsc}</span>`
    if (shortLine === 'inline') html += `${html ? ' — ' : ''}${chunk}`
    else below = `<div class="ve-summary-short ve-summary-short-below">${shortEsc}</div>`
  }
  return `<div class="ve-item ve-item-line">${html}${below}</div>`
}

/** The tabulation columns for a set of summaries: every part key present, in slot order. */
function summaryColumns(summaries: SummaryView[], layout: SummaryLayout): SummaryPartKey[] {
  const present = new Set<SummaryPartKey>()
  for (const s of summaries) for (const p of s.parts) if (p.value) present.add(p.key)
  const cols: SummaryPartKey[] = []
  for (const slot of slotsFor(layout)) for (const k of SLOT_KEYS[slot]) if (present.has(k)) cols.push(k)
  return cols
}

/**
 * Render a summary-detail section as an aligned column grid — one column per
 * present part (title · role · org · start · end / date). The heading stays
 * OUTSIDE the grid (the grid is its own element), so it isn't pulled into a
 * column. Every value goes through escapeHtml; the grid template is a computed
 * integer count, never user data.
 */
function renderTabulatedSummary(sectionKey: string, items: unknown[], ctx: RenderCtx): string {
  const desc = SECTION_CATALOG[sectionKey]
  if (!desc?.summary) return ''
  const cctx: CatalogCtx = { locale: ctx.locale, hideDates: !!ctx.style.hide_dates, dateFormat: ctx.style.date_format, target: 'html', detail: 'tabulated', kq: kqVisibility(ctx.style, 'summary') }
  const summaries = items
    .map((it) => desc.summary!(it as AnyItem, cctx))
    .filter((s): s is SummaryView => !!s)
  if (!summaries.length) return ''
  const partCols = summaryColumns(summaries, ctx.style.summary_layout)
  if (!partCols.length) return ''
  // Insert a dedicated separator column between adjacent start & end date
  // columns, so the range markers line up down the grid.
  const cols: Array<SummaryPartKey | 'sep'> = []
  for (let i = 0; i < partCols.length; i++) {
    cols.push(partCols[i])
    if (partCols[i] === 'start' && partCols[i + 1] === 'end') cols.push('sep')
  }
  // Text columns (title/role/org) flex and wrap so no row runs past the page
  // edge; the short date columns hug their content. Computed from column KINDS
  // only — never user data — so it's safe to inline.
  const flexes = (c: SummaryPartKey | 'sep'): boolean => c === 'title' || c === 'role' || c === 'org'
  const template = cols.map((c) => (flexes(c) ? 'minmax(0, max-content)' : 'max-content')).join(' ')
  const rows = summaries
    .map((s) => {
      const map = new Map(s.parts.map((p) => [p.key, p.value]))
      const cells = cols
        .map((c) => {
          if (c === 'sep') {
            const both = !!(map.get('start') && map.get('end'))
            return `<span class="ve-tab-sep">${both ? '·' : ''}</span>`
          }
          const cls = c === 'title' ? 've-tab-title' : flexes(c) ? 've-tab-text' : 've-tab-date'
          // A part may carry '\n' line breaks (Languages' Europass column).
          // Escape each line, THEN join with our own <br> — never the reverse.
          const cell = escapeHtml(map.get(c) ?? '').split('\n').join('<br>')
          return `<span class="${cls}">${cell}</span>`
        })
        .join('')
      return `<div class="ve-tab-row">${cells}</div>`
    })
    .join('')
  return `<div class="ve-tab-grid" style="grid-template-columns:${template}">${rows}</div>`
}

/**
 * The HTML render adapter (roadmap A5): turns a section descriptor's data view
 * into markup. This function and renderTagsHtml are the ONLY places item data
 * becomes HTML — every interpolation below goes through escapeHtml or
 * renderRichHtml (which escapes via the same callback). Section semantics live
 * in lib/sectionCatalog.ts; only layout lives here.
 */
function renderItem(sectionKey: string, item: unknown, ctx: RenderCtx): string {
  const desc = SECTION_CATALOG[sectionKey]
  if (!desc) return ''
  const cctx: CatalogCtx = { locale: ctx.locale, hideDates: !!ctx.style.hide_dates, dateFormat: ctx.style.date_format, target: 'html', kq: kqVisibility(ctx.style, ctx.detail === 'summary' ? 'summary' : 'full') }

  if (ctx.detail === 'summary' && !desc.alwaysFull) {
    const s = desc.summary?.(item as AnyItem, cctx)
    if (!s) return ''
    const short = resolve((item as AnyItem).short_description as LocalizedString | undefined, ctx.locale)
    return renderSummaryInline(s, ctx.style.summary_layout, short, ctx.style.short_desc_line)
  }

  const v = desc.full?.(item as AnyItem, cctx)
  if (!v) return ''

  if (v.layout === 'inline') {
    const metaTxt = v.meta.filter(Boolean).join(' · ')
    // extraLines drop below the line (Languages' split Europass passport).
    const extra = v.extraLines.filter(Boolean)
      .map((l) => `<div class="ve-inline-extra">${escapeHtml(l)}</div>`).join('')
    return `<div class="ve-item ve-inline"><div><strong>${escapeHtml(v.title)}</strong>${
      metaTxt ? ` — ${escapeHtml(metaTxt)}` : ''
    }</div>${extra}</div>`
  }

  if (v.layout === 'quote') {
    const tail = v.attributionMeta.filter(Boolean).join(' · ')
    return `<div class="ve-item ve-rec">
        <div class="ve-rec-quote">${renderRichHtml(v.body, escapeHtml)}</div>
        <div class="ve-rec-attrib">— ${escapeHtml(v.attribution)}${tail ? ` <span class="ve-meta-inline">${escapeHtml(tail)}</span>` : ''}</div>
      </div>`
  }

  // Compose the details line from the organisation meta + the (separate) date,
  // in the order the full-item layout asks for. `date` is '' when hidden.
  const layout = ctx.style.date_position
  const dateFirst = layout === 'title-date-org' || layout === 'lead-date-org'
  const lead = layout === 'lead-org-date' || layout === 'lead-date-org'
  const metaParts = v.meta.filter(Boolean)
  const metaTxt = (dateFirst ? [v.date, ...metaParts] : [...metaParts, v.date]).filter(Boolean).join(' · ')
  const pointsHtml = v.points.length
    ? `<ul class="ve-points">${v.points
        .map((p) => `<li>${p.label ? `<strong>${escapeHtml(p.label)}</strong>: ` : ''}${renderRichHtml(p.body, escapeHtml)}</li>`)
        .join('')}</ul>`
    : ''
  const titleHtml = v.title ? `<h3>${escapeHtml(v.title)}</h3>` : ''
  const metaLine = metaTxt ? `<div class="ve-meta">${escapeHtml(metaTxt)}</div>` : ''
  // `lead-*` puts the details line above the title.
  const head = lead ? `${metaLine}${titleHtml}` : `${titleHtml}${metaLine}`
  const inner = `${head}
        ${v.body ? `<div class="ve-desc">${renderRichHtml(v.body, escapeHtml)}</div>` : ''}
        ${pointsHtml}
        ${renderTagsHtml(v.tags, ctx.style)}`
  // Bullets (default layout only): a two-column flex row places the glyph in
  // its own column so every content line aligns under the heading, not the
  // bullet. Off by default, so the plain `.ve-item` markup is unchanged.
  if (ctx.style.item_bullets) {
    return `<div class="ve-item ve-bulleted">
        <span class="ve-bullet" aria-hidden="true">${escapeHtml(bulletGlyph(ctx.style))}</span>
        <div class="ve-item-main">${inner}</div>
      </div>`
  }
  return `<div class="ve-item">
        ${inner}
      </div>`
}

/**
 * Build the per-section style classes that the global CSS targets.
 * Each section gets a unique class — `ve-sec-{key}` — so we can override
 * dividers/density without touching the global rules.
 */
function sectionStyleCss(secKey: string, resolved: ResolvedSectionStyle, baseTokens: StyleTokens): string {
  const tokens = deriveTokens(resolved)
  const showDivider = resolved.item_divider
  const rule = showDivider ? dividerRule(resolved.divider_style, baseTokens.accentCss) : { border: 'none', extra: '' }
  // Tabulated rows are subgrid boxes (see the base .ve-tab-row rule), so the
  // SAME density (row gap + line height) and divider style apply to them too.
  const rowGap = Math.max(2, Math.round(tokens.itemGapPx / 2))
  const rowPad = showDivider ? Math.max(1, Math.round(rowGap / 2)) : 0
  return `
    .ve-sec-${secKey} .ve-item {
      margin-bottom: ${tokens.itemGapPx}px;
      padding-bottom: ${showDivider ? tokens.itemGapPx : 0}px;
      border-bottom: ${rule.border};
      line-height: ${tokens.lineHeight};
      ${rule.extra}
    }
    .ve-sec-${secKey} .ve-item:last-child { border-bottom: none; background-image: none; padding-bottom: 0; margin-bottom: 0; }
    .ve-sec-${secKey} .ve-tab-grid { row-gap: ${rowGap}px; }
    .ve-sec-${secKey} .ve-tab-row {
      line-height: ${tokens.lineHeight};
      padding-bottom: ${rowPad}px;
      border-bottom: ${rule.border};
      ${rule.extra}
    }
    .ve-sec-${secKey} .ve-tab-row:last-child { border-bottom: none; background-image: none; padding-bottom: 0; }
  `
}

/**
 * CSS for a between-items divider in the given style. Full-width variants use
 * `border-bottom`; the short rule is drawn as a bottom-left background line
 * (a border can't be width-limited), and 'space' draws nothing (gap only).
 */
function dividerRule(style: ResolvedSectionStyle['divider_style'], accentCss: string): { border: string; extra: string } {
  const faint = `${accentCss}1A`
  switch (style) {
    case 'space':  return { border: 'none', extra: '' }
    case 'thick':  return { border: `2px solid ${faint}`, extra: '' }
    case 'dashed': return { border: `1px dashed ${accentCss}40`, extra: '' }
    case 'dotted': return { border: `1px dotted ${accentCss}55`, extra: '' }
    case 'double': return { border: `3px double ${accentCss}40`, extra: '' }
    case 'short':  return {
      border: 'none',
      extra: `background-image: linear-gradient(${accentCss}55, ${accentCss}55); background-repeat: no-repeat; background-position: left bottom; background-size: 48px 1px;`,
    }
    case 'line':
    default:       return { border: `1px solid ${faint}`, extra: '' }
  }
}

export function buildViewHtml(store: ResumeStore, view: ResumeView, locale: string, globalFonts?: GlobalFonts): string {
  const r = store.resume
  if (!r) return '<p>No resume data</p>'

  const viewStyle = withResolvedFonts(withDefaults(view.style), globalFonts)
  const tokens = deriveTokens(viewStyle)

  const filtered = applyView(store, view)
  const lc = (ls_: LocalizedString | undefined) => resolve(ls_, locale)

  const contentSections = SECTIONS.filter(isExportableSection)

  const enabledSections = contentSections
    .map((s) => {
      const vs = view.sections.find((v) => v.key === s.key)
      return {
        ...s,
        sort_order: vs?.sort_order ?? 999,
        detail: vs?.detail ?? defaultViewDetail(s.key),
        sectionStyle: vs?.style,
        sort: vs?.sort ?? 'custom',
      }
    })
    .filter((s) => s.detail !== 'off')
    .sort((a, b) => a.sort_order - b.sort_order)

  const perSectionCss: string[] = []
  const sectionsHtml = enabledSections
    .map((s) => {
      if (!s.storeKey) return ''
      // Synthetic skill matrix: a table over the registry, not item markup.
      // All cell values are escaped right here — keep it that way.
      if (s.key === 'skill_matrix') {
        const resolved = resolveSectionStyle(viewStyle, s.sectionStyle)
        const rows = skillMatrixRows(store, view, locale, { highlightedOnly: s.detail === 'summary' })
        if (!rows.length) return ''
        const heading = sectionHeadingHtml(resolved, s.key, s.icon, locale)
        const showDates = !resolved.hide_dates
        // Show the Category column only if at least one row has a category.
        const showCategory = rows.some((row) => row.category)
        const head = `<tr><th>${escapeHtml(xs('matrix_skill', locale))}</th>${showCategory ? `<th>${escapeHtml(xs('matrix_category', locale))}</th>` : ''}<th>${escapeHtml(xs('matrix_experience', locale))}</th><th>${escapeHtml(xs('matrix_proficiency', locale))}</th>${showDates ? `<th>${escapeHtml(xs('matrix_last_used', locale))}</th>` : ''}</tr>`
        const body = rows.map((row) =>
          `<tr><td>${escapeHtml(row.name)}</td>${showCategory ? `<td>${escapeHtml(row.category)}</td>` : ''}<td>${escapeHtml(fmtYears(row.years, locale))}</td><td>${escapeHtml(fmtProficiency(row.proficiency))}</td>${showDates ? `<td>${escapeHtml(fmtLastUsed(row, locale, resolved.date_format))}</td>` : ''}</tr>`,
        ).join('\n')
        return `<section class="ve-section ve-sec-skill_matrix">
  ${heading}
  <table class="ve-matrix"><thead>${head}</thead><tbody>${body}</tbody></table>
</section>`
      }
      // Virtual promoted_projects derives its items from the starred projects;
      // virtual technology_categories (Skills Showcase) derives its groups
      // from the skill-category system; every other section reads its
      // filtered store array.
      const rawItems = s.key === 'promoted_projects'
        ? promotedProjectItems(store, view)
        : s.key === 'technology_categories'
          ? showcaseGroups(store, view, locale)
          : (filtered[s.storeKey] as unknown[])
      if (!rawItems.length) return ''
      // Order by the view's per-section sort (default 'custom' = the resume's
      // arranged sort_order) so the export matches the chosen order. The Skills
      // Showcase groups arrive pre-ordered (by category), so leave them be.
      const items = s.key === 'technology_categories'
        ? rawItems
        : sortItems(
            renderKeyFor(s.key),
            rawItems as Array<{ id: string; sort_order: number }>,
            s.sort,
            locale,
          )
      const resolved = resolveSectionStyle(viewStyle, s.sectionStyle)
      const ctx: RenderCtx = { locale, detail: s.detail, style: resolved }
      const renderKey = renderKeyFor(s.key)
      const desc = SECTION_CATALOG[renderKey]
      // Tabulation only applies to the one-line summary layout (never full or
      // always-full sections like spoken languages).
      const tabulated = resolved.tabulate && s.detail === 'summary' && !!desc?.summary && !desc?.alwaysFull
      // Per-section density/divider CSS applies to BOTH the regular item list and
      // the tabulated grid (the rules target `.ve-item` and `.ve-tab-row`).
      perSectionCss.push(sectionStyleCss(s.key, resolved, tokens))
      const itemsHtml = tabulated
        ? renderTabulatedSummary(renderKey, items, ctx)
        : items.map((item) => renderItem(renderKey, item, ctx)).filter(Boolean).join('\n')
      if (!itemsHtml) return ''
      // s.label is a hardcoded constant from SECTIONS; the custom heading is
      // untrusted view config. Both go through escapeHtml here.
      const heading = sectionHeadingHtml(resolved, s.key, s.icon, locale)
      return `<section class="ve-section ve-sec-${s.key}">
  ${heading}
  ${itemsHtml}
</section>`
    })
    .filter(Boolean)
    .join('\n')

  const intro = escapeHtml(lc(view.introduction))

  // ── Header (configurable identity block) ──────────────────────────────────
  const header = withHeaderDefaults(view.header)
  const footer = withFooterDefaults(view.footer)

  const photoSrc = header.photo_override ?? r.profile_photo ?? null
  const logoSrc = header.logo_override ?? r.company_logo ?? null
  const showPhoto = header.photo_placement !== 'none' && isDataImage(photoSrc)
  const showLogo = header.logo_placement !== 'none' && isDataImage(logoSrc)

  const nameSizePt = header.name_style.size_pt ?? tokens.h1Pt
  const titleSizePt = header.title_style.size_pt ?? tokens.smallFontSizePt + 1
  const nameStyleCss = `font-family:${resolveFontCss(header.name_style.font, tokens.bodyFontId)};font-size:${nameSizePt}pt;`
  const titleStyleCss = `font-family:${resolveFontCss(header.title_style.font, tokens.bodyFontId)};font-size:${titleSizePt}pt;`

  const lines = buildHeaderLines(header, r, store, locale)
  const sep = escapeHtml(header.separator)
  const contactHtml = lines
    .map((line) => {
      const segs = line
        .map((s) => `${s.label ? `<span class="ve-hlabel">${escapeHtml(s.label)}</span>` : ''}${escapeHtml(s.value)}`)
        .join(`<span class="ve-hsep">${sep}</span>`)
      return `<div class="ve-hline">${segs}</div>`
    })
    .join('\n')

  // The view can override the resume's professional title/headline.
  const titleText = escapeHtml(lc(header.title_override) || lc(r.title))
  // photo_shape is sanitised by withHeaderDefaults — only ever 'square' /
  // 'rounded' / 'circle' here, so it's safe to interpolate as a class name.
  const photoImg = showPhoto
    ? `<img class="ve-photo ve-photo-shape-${header.photo_shape}" src="${escapeHtml(photoSrc!)}" alt="">`
    : ''
  const nameTitleHtml = `<h1 class="ve-name" style="${nameStyleCss}">${escapeHtml(r.full_name)}</h1>
    ${titleText ? `<div class="ve-header-title" style="${titleStyleCss}">${titleText}</div>` : ''}`
  const contactBlockHtml = contactHtml ? `<div class="ve-header-contact">${contactHtml}</div>` : ''
  // "…_of_name" placements sit the photo beside the NAME+TITLE only, with the
  // contact details on their own full-width row below.
  const photoBesideName = header.photo_placement === 'left_of_name' || header.photo_placement === 'right_of_name'
  let headerInner: string
  if (photoBesideName) {
    headerInner = `<div class="ve-nametitle-row">${photoImg}<div class="ve-identity">${nameTitleHtml}</div></div>${contactBlockHtml}`
  } else {
    const identityHtml = `<div class="ve-identity">${nameTitleHtml}${contactBlockHtml}</div>`
    headerInner = header.photo_placement === 'below'
      ? `${identityHtml}${photoImg}`
      : `${photoImg}${identityHtml}`
  }
  const logoHtml = showLogo
    ? `<div class="ve-logo-banner ve-logo-${header.logo_placement}"><img class="ve-logo" src="${escapeHtml(logoSrc!)}" alt=""></div>`
    : ''

  // ── Footer (closing visual) ───────────────────────────────────────────────
  // Compose from the PLAIN values, then escape each finished line — the
  // placement joins with our own separators, so escaping last would mangle
  // them and escaping the parts first would double-escape.
  const footLines = footerLines(
    footer,
    buildCopyrightLine(footer, r, new Date().getFullYear(), locale),
    lc(footer.note),
  )
  const footerText = footLines.map((l) => `<div class="ve-copyright">${escapeHtml(l)}</div>`).join('')
  const showFooter = footer.separator !== 'none' || !!footLines.length
  const footerHtml = showFooter
    ? `<footer class="ve-footer ve-footer-${footer.separator}">${footerText}</footer>`
    : ''

  // Restrictive CSP: blocks any script execution inside the generated document
  // (defence in depth — the escape-at-render above is the primary defence).
  // Both consumers tolerate it: the preview iframe/pop-out never needs to run
  // scripts, and printing from the pop-out is browser chrome, not page script.
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    // Fonts are self-hosted (/fonts/*). 'self' resolves to the app origin in
    // every context this document renders in: the srcdoc preview iframe and
    // the about:blank print/pop-out windows all inherit the opener's origin.
    "font-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')

  return `<!DOCTYPE html>
<html lang="${escapeHtml(bcp47(locale))}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>${escapeHtml(view.name)} — ${escapeHtml(r.full_name)}</title>
  <style>
    /* Self-hosted brand fonts — same files the app shell uses. */
    @font-face { font-family: 'Open Sans Condensed'; font-style: normal; font-weight: 300; font-display: swap;
      src: url('/fonts/open-sans-condensed-300-latin.woff2') format('woff2');
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
    @font-face { font-family: 'Open Sans Condensed'; font-style: normal; font-weight: 300; font-display: swap;
      src: url('/fonts/open-sans-condensed-300-latin-ext.woff2') format('woff2');
      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
    @font-face { font-family: 'Ubuntu'; font-style: normal; font-weight: 400; font-display: swap;
      src: url('/fonts/ubuntu-400-latin.woff2') format('woff2');
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
    @font-face { font-family: 'Ubuntu'; font-style: normal; font-weight: 400; font-display: swap;
      src: url('/fonts/ubuntu-400-latin-ext.woff2') format('woff2');
      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
    @font-face { font-family: 'Ubuntu'; font-style: normal; font-weight: 500; font-display: swap;
      src: url('/fonts/ubuntu-500-latin.woff2') format('woff2');
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
    @font-face { font-family: 'Ubuntu'; font-style: normal; font-weight: 500; font-display: swap;
      src: url('/fonts/ubuntu-500-latin-ext.woff2') format('woff2');
      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${tokens.bodyFontCss}; font-size: ${tokens.bodyFontSizePt}pt; color: #111111; line-height: ${tokens.lineHeight};
           padding: ${tokens.pagePadCss}; max-width: 820px; margin: 0 auto; }
    h1  { font-family: ${tokens.headingFontCss}; font-weight: 300; font-size: ${tokens.h1Pt}pt;
           color: ${tokens.headingCss}; margin-bottom: 4px; }
    h2  { font-family: ${tokens.headingFontCss}; font-weight: 300; font-size: ${tokens.h2Pt}pt;
           color: ${tokens.headingCss}; border-bottom: 1.5px solid ${tokens.accentCss}33; padding-bottom: 5px;
           margin: ${tokens.itemGapPx * 2}px 0 ${tokens.sectionHeadingAfterPx}px; }
    h3  { font-size: ${tokens.h3Pt}pt; font-weight: 600; color: ${tokens.headingCss}; margin-bottom: 3px; }
    /* Optional section icon before the heading — sized to the text, coloured
       with the accent (icons/underline share the accent colour). */
    .ve-sec-icon { width: 1em; height: 1em; vertical-align: -0.13em; margin-right: 0.42em; color: ${tokens.accentCss}; }
    .ve-header-title  { color: #374151; margin: 3px 0 8px; }
    .ve-header-contact { font-size: ${tokens.metaFontSizePt}pt; color: #6B7280; }
    .ve-hline { margin: 1px 0; }
    .ve-hlabel { color: #9097A1; }
    .ve-hsep { color: #C2C7CE; padding: 0 2px; }
    /* Logo banner */
    .ve-logo-banner { margin-bottom: 10px; display: flex; }
    .ve-logo-banner.ve-logo-left { justify-content: flex-start; }
    .ve-logo-banner.ve-logo-center { justify-content: center; }
    .ve-logo-banner.ve-logo-right { justify-content: flex-end; }
    .ve-logo { max-height: 52px; max-width: 240px; width: auto; height: auto; object-fit: contain; }
    /* Identity + photo layout */
    .ve-header { margin-bottom: 6px; }
    .ve-header.ve-photo-left  { display: flex; gap: 18px; align-items: flex-start; }
    .ve-header.ve-photo-right { display: flex; gap: 18px; align-items: flex-start; flex-direction: row-reverse; }
    .ve-header.ve-photo-above { display: flex; gap: 12px; flex-direction: column; align-items: flex-start; }
    .ve-header.ve-photo-below { display: flex; gap: 12px; flex-direction: column; align-items: flex-start; }
    /* Photo beside the name+title only — contact details full-width below. */
    .ve-header.ve-photo-left_of_name, .ve-header.ve-photo-right_of_name { display: block; }
    .ve-photo-left_of_name .ve-nametitle-row,
    .ve-photo-right_of_name .ve-nametitle-row { display: flex; gap: 18px; align-items: center; margin-bottom: 6px; }
    .ve-photo-right_of_name .ve-nametitle-row { flex-direction: row-reverse; }
    .ve-identity { min-width: 0; }
    .ve-photo {
      width: 112px; height: 112px; object-fit: cover;
      flex-shrink: 0; border: 1px solid ${tokens.accentCss}22;
    }
    /* Profile photo shape — picked per view (square / rounded / circle). */
    .ve-photo-shape-square  { border-radius: 0; }
    .ve-photo-shape-rounded { border-radius: 18px; }
    .ve-photo-shape-circle  { border-radius: 50%; }
    /* Footer */
    .ve-footer { margin-top: 28px; padding-top: 12px; }
    .ve-footer-line   { border-top: 1px solid ${tokens.accentCss}66; }
    .ve-footer-double { border-top: 3px double ${tokens.accentCss}88; }
    .ve-footer-dotted { border-top: 2px dotted ${tokens.accentCss}66; }
    .ve-footer-dashed { border-top: 2px dashed ${tokens.accentCss}66; }
    .ve-footer-thick  { border-top: 3px solid ${tokens.accentCss}; }
    .ve-copyright { text-align: center; font-size: ${tokens.metaFontSizePt}pt; color: #9097A1; margin-top: 8px; }
    /* Intro reads like the profile/summary prose — same body size and colour,
       no callout box — so a view's introduction and its professional summary
       share one look and feel. */
    .ve-intro { margin: 14px 0 18px; font-size: ${tokens.bodyFontSizePt}pt;
                line-height: ${tokens.lineHeight}; color: #1f2937; white-space: pre-line; }
    .ve-section { margin-bottom: 8px; }
    .ve-item { margin-bottom: ${tokens.itemGapPx}px; padding-bottom: ${tokens.itemGapPx}px; border-bottom: 1px solid ${tokens.accentCss}1A; }
    /* Item bullets (opt-in): the glyph sits in its own column and the content
       column carries everything else, so every wrapped line aligns under the
       heading rather than under the bullet (a hanging indent). */
    .ve-item.ve-bulleted { display: flex; gap: 0.5em; }
    .ve-bullet { flex: 0 0 auto; color: ${tokens.headingCss}; font-weight: 600; line-height: ${tokens.h3Pt}pt; }
    .ve-item-main { flex: 1 1 auto; min-width: 0; }
    /* Tabulated summary: an aligned column grid holding just the item rows (the
       section heading stays outside it). Each part — title, role, org, start,
       (separator,) end — lands in its own column, sized to the widest entry.
       The grid is capped at the page width; the title column is the flexible one
       (minmax 0), so a very long title wraps instead of pushing the row past the
       page edge. */
    .ve-tab-grid { display: grid; column-gap: 12px; row-gap: ${Math.max(2, Math.round(tokens.itemGapPx / 2))}px;
                   font-size: ${tokens.smallFontSizePt}pt; margin-top: 2px; max-width: 100%; }
    /* Each row is a subgrid box spanning all columns, so it stays column-aligned
       AND can carry a per-section divider + density padding (unlike display:contents). */
    .ve-tab-row { display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; align-items: baseline; }
    /* Text columns wrap (min-width:0) so a long title/employer stays on the
       page; the short date columns never wrap. */
    .ve-tab-title { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
    .ve-tab-text { color: #4B5563; min-width: 0; overflow-wrap: anywhere; }
    .ve-tab-date { color: #4B5563; white-space: nowrap; }
    /* Date-range separator gets its own narrow column so the marks line up.
       Negative side margins pull the from/to dates tight around the dot (like
       the summary view), independent of the density's column gap. */
    .ve-tab-sep { color: #9CA3AF; text-align: center; white-space: nowrap; margin: 0 -8px; }
    .ve-item:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .ve-item-line { padding-bottom: 0; border-bottom: none; margin-bottom: 4px; font-size: ${tokens.smallFontSizePt}pt; }
    .ve-summary-short { color: #6B7280; }
    .ve-summary-short-below { margin-top: 1px; font-size: ${tokens.metaFontSizePt}pt; }
    .ve-meta-inline { color: #6B7280; }
    /* Languages' FULL mode: one line per language (its Europass passport may
       drop onto lines below it, so these can't flow side by side). */
    .ve-inline { display: block; }
    .ve-inline-extra { font-size: ${tokens.metaFontSizePt}pt; color: #6B7280; margin-left: 12px; }
    /* Languages' SUMMARY mode: the compact scan line — every language flows
       side by side and wraps. Scoped to the section; every other section's
       summary stays one item per line. */
    .ve-sec-spoken_languages .ve-item-line { display: inline-block; margin-right: 20px; }
    .ve-sec-spoken_languages .ve-item-line:last-child { margin-right: 0; }
    .ve-meta { font-size: ${tokens.metaFontSizePt}pt; color: #6B7280; margin: 2px 0 5px; }
    .ve-desc { font-size: ${tokens.smallFontSizePt}pt; color: #374151; margin-top: 5px; }
    .ve-desc p { margin: 0 0 4px; }
    .ve-desc p:last-child { margin-bottom: 0; }
    .ve-desc ul, .ve-desc ol { margin: 5px 0 5px 18px; }
    .ve-desc li { margin-bottom: 2px; }
    .ve-points { margin: 8px 0 0 18px; font-size: ${tokens.smallFontSizePt}pt; color: #374151; }
    .ve-points li { margin-bottom: 3px; }
    .ve-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
    .ve-tag { background: ${tokens.accentCss}14; color: ${tokens.accentCss}; font-size: ${tokens.metaFontSizePt}pt;
              padding: 2px 8px; border-radius: 10px; }
    .ve-tags-inline { font-style: italic; color: #6B7280; font-size: ${tokens.metaFontSizePt}pt; margin-top: 6px; }
    .ve-rec-quote { font-style: italic; color: #374151; font-size: ${tokens.smallFontSizePt}pt;
                    border-left: 3px solid ${tokens.accentCss}33; padding-left: 12px; }
    .ve-rec-attrib { font-size: ${tokens.metaFontSizePt}pt; color: #6B7280; margin-top: 5px; padding-left: 12px; }
    .ve-matrix { width: 100%; border-collapse: collapse; font-size: ${tokens.smallFontSizePt}pt; }
    .ve-matrix th { text-align: left; color: ${tokens.accentCss}; font-weight: 600;
                    border-bottom: 1.5px solid ${tokens.accentCss}55; padding: 3px 10px 3px 0; }
    .ve-matrix td { border-bottom: 1px solid ${tokens.accentCss}1A; padding: 3px 10px 3px 0; color: #374151; }
    .ve-matrix tr:last-child td { border-bottom: none; }
    ${perSectionCss.join('\n')}
    @media print {
      body { padding: 0; }
      .ve-item { break-inside: avoid; }
      h2 { break-before: auto; }
    }
  </style>
</head>
<body>
  ${logoHtml}
  <div class="ve-header${showPhoto ? ` ve-photo-${header.photo_placement}` : ''}">
    ${headerInner}
  </div>

  ${intro ? `<div class="ve-intro">${intro}</div>` : ''}

  ${sectionsHtml}

  ${footerHtml}
</body>
</html>`
}
