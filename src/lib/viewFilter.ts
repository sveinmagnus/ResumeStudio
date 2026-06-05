import type {
  ResumeStore, ResumeView, ViewSection, LocalizedString, SectionDetail,
} from '../types'
import { SECTIONS } from './sections'
import { resolve, fmtRange, fmtDate } from './locales'
import { renderRichHtml } from './richText'
import { DEFAULT_VIEW_STYLE, deriveTokens, resolveSectionStyle, withDefaults, resolveFontCss, type ResolvedSectionStyle, type StyleTokens } from './viewStyle'
import { withHeaderDefaults, withFooterDefaults, buildHeaderLines, buildCopyrightLine } from './viewHeader'

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
 * sections default to 'full'; the synthetic `promoted_projects` defaults to
 * 'off' so existing and new views aren't changed until the user enables it.
 */
export function defaultViewDetail(key: string): SectionDetail {
  return key === 'promoted_projects' ? 'off' : 'full'
}

/** The renderer/title key a section uses — promoted_projects reuses the project renderer. */
function renderKeyFor(key: string): string {
  return key === 'promoted_projects' ? 'projects' : key
}

/**
 * Source items for the synthetic "Promoted Projects" view section: the starred,
 * enabled, non-excluded projects. Independent of the regular Projects section's
 * detail, so a view can show Projects='off' + Promoted='full' for a clean,
 * promoted-only CV. Shared by both render paths and the view editor's item list.
 */
export function promotedProjectItems(store: ResumeStore, view: ResumeView): unknown[] {
  const excluded = new Set(view.excluded_item_ids)
  return store.projects.filter(
    (p) => !p.disabled && !excluded.has(p.id) && p.starred,
  )
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

type AnyItem = Record<string, unknown>

function ls(item: AnyItem, field: string, locale: string): string {
  return resolve(item[field] as LocalizedString | undefined, locale)
}

type YM = { year: number; month: number | null } | null

function range(item: AnyItem): string {
  return fmtRange(item.start as YM, item.end as YM)
}

export function getItemTitle(sectionKey: string, item: unknown, locale: string): string {
  const it = item as AnyItem
  switch (sectionKey) {
    case 'promoted_projects':
    case 'projects':           return ls(it, 'customer', locale) || ls(it, 'description', locale) || 'Untitled project'
    case 'key_qualifications': return ls(it, 'label', locale) || 'Untitled profile'
    case 'key_competencies':   return ls(it, 'title', locale) || 'Untitled competency'
    case 'recommendations':    return (it.recommender_name as string) || 'Recommendation'
    case 'work_experiences':   return ls(it, 'employer', locale) || 'Untitled employer'
    case 'educations':         return ls(it, 'school', locale) || 'Untitled school'
    case 'courses':            return ls(it, 'name', locale) || 'Untitled'
    case 'certifications':     return ls(it, 'name', locale) || 'Untitled'
    case 'positions':          return ls(it, 'name', locale) || 'Untitled'
    case 'presentations':      return ls(it, 'title', locale) || 'Untitled'
    case 'honor_awards':       return ls(it, 'name', locale) || 'Untitled'
    case 'publications':       return ls(it, 'title', locale) || 'Untitled'
    case 'technology_categories': return ls(it, 'name', locale) || 'Untitled'
    case 'spoken_languages':   return ls(it, 'name', locale) || 'Untitled'
    case 'references':         return (it.name as string) || 'Unnamed'
    case 'skills':             return ls(it, 'name', locale) || 'Unnamed skill'
    case 'roles':              return ls(it, 'name', locale) || 'Unnamed role'
    default:                   return String(it.id || 'Item')
  }
}

export function getItemSubtitle(sectionKey: string, item: unknown, locale: string): string {
  const it = item as AnyItem
  switch (sectionKey) {
    case 'promoted_projects':
    case 'projects':         return range(it)
    case 'recommendations':  return [it.recommender_title, it.recommender_company].filter(Boolean).join(', ')
    case 'work_experiences': return `${ls(it, 'role_title', locale)}${range(it) ? ' · ' + range(it) : ''}`
    case 'educations':       return `${ls(it, 'degree', locale)}${range(it) ? ' · ' + range(it) : ''}`
    case 'positions':        return `${ls(it, 'organisation', locale)}${range(it) ? ' · ' + range(it) : ''}`
    case 'presentations':    return ls(it, 'event', locale)
    case 'publications':     return ls(it, 'publisher', locale)
    case 'certifications':   return ls(it, 'organiser', locale)
    case 'courses':          return ls(it, 'program', locale)
    default:                 return ''
  }
}

// ─── View detail / section helpers ──────────────────────────────────────────

/** Resolve a section's detail level — defaults to 'full' if the view doesn't list it. */
function sectionDetail(view: ResumeView, key: string): SectionDetail {
  return view.sections.find((s) => s.key === key)?.detail ?? 'full'
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
    const items = store[sec.storeKey] as Array<{ id: string; disabled?: boolean; starred?: boolean }>

    if (detail === 'off') {
      ;(filtered as Record<string, unknown>)[sec.storeKey] = []
    } else {
      ;(filtered as Record<string, unknown>)[sec.storeKey] = items.filter((item) => {
        if (item.disabled) return false
        if (excluded.has(item.id)) return false
        if (view.starred_only && !item.starred) return false
        return true
      })
    }
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
 * — which would let a malicious imported file exfiltrate the API token from
 * sessionStorage. The generated document also carries a restrictive CSP, but
 * escape-at-render is the primary defence.
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

/**
 * Render the meta line (dates · role · industry · …) honouring the section
 * style's hide_dates flag.
 */
function metaLine(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' · ')
}

interface RenderCtx {
  locale: string
  detail: SectionDetail
  style: ResolvedSectionStyle
}

function renderItem(sectionKey: string, item: unknown, ctx: RenderCtx): string {
  const it = item as AnyItem
  const { locale, detail, style } = ctx
  const l = (field: string) => escapeHtml(ls(it, field, locale))
  // Rich-text variant: preserves the allowed inline tags (b/i/u/ul/ol/li/p/br)
  // for description-shaped fields. Plain values fall through to escapeHtml.
  const rich = (field: string) => renderRichHtml(ls(it, field, locale), escapeHtml)
  const r = style.hide_dates ? '' : escapeHtml(range(it))
  const date = (field: string) => style.hide_dates ? '' : escapeHtml(fmtDate(it[field] as YM))
  const isSummary = detail === 'summary'

  /**
   * Skills are either chips (default) or an inline italic comma list.
   * Suppressed entirely in summary mode.
   */
  const renderSkillTags = (skills: Array<{ name: LocalizedString }> | undefined): string => {
    if (isSummary || !skills?.length) return ''
    const names = skills.map((s) => resolve(s.name, locale)).filter(Boolean)
    if (!names.length) return ''
    if (style.tag_style === 'inline') {
      return `<div class="ve-tags-inline">${escapeHtml(names.join(', '))}</div>`
    }
    return `<div class="ve-tags">${names.map((n) => `<span class="ve-tag">${escapeHtml(n)}</span>`).join('')}</div>`
  }

  switch (sectionKey) {
    case 'projects': {
      const roleNames = (it.roles as Array<{ name: LocalizedString; disabled?: boolean }> ?? [])
        .filter((role) => !role.disabled)
        .map((role) => escapeHtml(resolve(role.name, locale)))
        .filter(Boolean)
      if (isSummary) {
        return `<div class="ve-item ve-item-line"><strong>${l('customer')}</strong>${metaLine([r, roleNames.join(', ')]) ? ` <span class="ve-meta-inline">— ${metaLine([r, roleNames.join(', ')])}</span>` : ''}</div>`
      }
      return `<div class="ve-item">
        <h3>${l('customer')}</h3>
        <div class="ve-meta">${metaLine([r, l('industry'), roleNames.join(', ')])}</div>
        <div class="ve-desc">${rich('long_description') || rich('description')}</div>
        ${renderSkillTags(it.skills as Array<{ name: LocalizedString }> | undefined)}
      </div>`
    }
    case 'key_qualifications': {
      if (isSummary) {
        return `<div class="ve-item ve-item-line"><strong>${l('label')}</strong>${l('tag_line') ? ` <span class="ve-meta-inline">— ${l('tag_line')}</span>` : ''}</div>`
      }
      const points = (it.key_points as Array<{ name: LocalizedString; long_description: LocalizedString }> ?? [])
        .map((p) => `<li><strong>${escapeHtml(resolve(p.name, locale))}</strong>: ${renderRichHtml(resolve(p.long_description, locale), escapeHtml)}</li>`)
        .join('')
      return `<div class="ve-item">
        <h3>${l('label')}</h3>
        <div class="ve-desc">${rich('summary')}</div>
        ${points ? `<ul class="ve-points">${points}</ul>` : ''}
      </div>`
    }
    case 'work_experiences':
      if (isSummary) {
        return `<div class="ve-item ve-item-line"><strong>${l('employer')}</strong>${metaLine([l('role_title'), r]) ? ` <span class="ve-meta-inline">— ${metaLine([l('role_title'), r])}</span>` : ''}</div>`
      }
      return `<div class="ve-item">
        <h3>${l('employer')}</h3>
        <div class="ve-meta">${metaLine([l('role_title'), r])}</div>
        <div class="ve-desc">${rich('long_description') || rich('description')}</div>
      </div>`
    case 'educations':
      if (isSummary) {
        return `<div class="ve-item ve-item-line"><strong>${l('school')}</strong>${metaLine([l('degree'), r]) ? ` <span class="ve-meta-inline">— ${metaLine([l('degree'), r])}</span>` : ''}</div>`
      }
      return `<div class="ve-item">
        <h3>${l('school')}</h3>
        <div class="ve-meta">${metaLine([l('degree'), r])}</div>
        <div class="ve-desc">${rich('description')}</div>
      </div>`
    case 'courses':
      if (isSummary) {
        return `<div class="ve-item ve-item-line"><strong>${l('name')}</strong>${metaLine([l('program'), date('completed')]) ? ` <span class="ve-meta-inline">— ${metaLine([l('program'), date('completed')])}</span>` : ''}</div>`
      }
      return `<div class="ve-item">
        <h3>${l('name')}</h3>
        <div class="ve-meta">${metaLine([l('program'), date('completed')])}</div>
        <div class="ve-desc">${rich('description')}</div>
      </div>`
    case 'certifications':
      if (isSummary) {
        return `<div class="ve-item ve-item-line"><strong>${l('name')}</strong>${metaLine([l('organiser'), date('issued')]) ? ` <span class="ve-meta-inline">— ${metaLine([l('organiser'), date('issued')])}</span>` : ''}</div>`
      }
      return `<div class="ve-item">
        <h3>${l('name')}</h3>
        <div class="ve-meta">${metaLine([l('organiser'), date('issued')])}</div>
        <div class="ve-desc">${rich('description')}</div>
      </div>`
    case 'positions':
      if (isSummary) {
        return `<div class="ve-item ve-item-line"><strong>${l('name')}</strong>${metaLine([l('organisation'), r]) ? ` <span class="ve-meta-inline">— ${metaLine([l('organisation'), r])}</span>` : ''}</div>`
      }
      return `<div class="ve-item">
        <h3>${l('name')}</h3>
        <div class="ve-meta">${metaLine([l('organisation'), r])}</div>
        <div class="ve-desc">${rich('description')}</div>
      </div>`
    case 'spoken_languages':
      return `<div class="ve-item ve-inline"><strong>${l('name')}</strong> — ${l('level')}</div>`
    case 'technology_categories': {
      if (isSummary) {
        const skillNames = (it.skills as Array<{ name: LocalizedString }> ?? [])
          .map((s) => resolve(s.name, locale))
          .filter(Boolean)
        return `<div class="ve-item ve-item-line"><strong>${l('name')}</strong>${skillNames.length ? `: <span class="ve-meta-inline">${escapeHtml(skillNames.join(', '))}</span>` : ''}</div>`
      }
      return `<div class="ve-item">
        <h3>${l('name')}</h3>
        ${renderSkillTags(it.skills as Array<{ name: LocalizedString }> | undefined)}
      </div>`
    }
    case 'presentations':
      if (isSummary) {
        return `<div class="ve-item ve-item-line"><strong>${l('title')}</strong>${metaLine([l('event'), date('date')]) ? ` <span class="ve-meta-inline">— ${metaLine([l('event'), date('date')])}</span>` : ''}</div>`
      }
      return `<div class="ve-item">
        <h3>${l('title')}</h3>
        <div class="ve-meta">${metaLine([l('event'), date('date')])}</div>
        <div class="ve-desc">${rich('description')}</div>
      </div>`
    case 'honor_awards':
      if (isSummary) {
        return `<div class="ve-item ve-item-line"><strong>${l('name')}</strong>${metaLine([l('issuer'), date('date')]) ? ` <span class="ve-meta-inline">— ${metaLine([l('issuer'), date('date')])}</span>` : ''}</div>`
      }
      return `<div class="ve-item">
        <h3>${l('name')}</h3>
        <div class="ve-meta">${metaLine([l('issuer'), date('date')])}</div>
        <div class="ve-desc">${rich('description')}</div>
      </div>`
    case 'publications':
      if (isSummary) {
        return `<div class="ve-item ve-item-line"><strong>${l('title')}</strong>${metaLine([l('publisher'), date('date')]) ? ` <span class="ve-meta-inline">— ${metaLine([l('publisher'), date('date')])}</span>` : ''}</div>`
      }
      return `<div class="ve-item">
        <h3>${l('title')}</h3>
        <div class="ve-meta">${metaLine([l('publisher'), date('date')])}</div>
        <div class="ve-desc">${rich('abstract')}</div>
      </div>`
    case 'key_competencies':
      if (isSummary) {
        return `<div class="ve-item ve-item-line"><strong>${l('title')}</strong></div>`
      }
      return `<div class="ve-item">
        <h3>${l('title')}</h3>
        <div class="ve-desc">${rich('description')}</div>
      </div>`
    case 'recommendations': {
      const name = escapeHtml(it.recommender_name as string)
      const attribBits = [
        escapeHtml(it.recommender_title as string),
        escapeHtml(it.recommender_company as string),
      ].filter(Boolean).join(', ')
      const d = date('date')
      if (isSummary) {
        return `<div class="ve-item ve-item-line"><strong>${name}</strong>${attribBits || d ? ` <span class="ve-meta-inline">— ${[attribBits, d].filter(Boolean).join(' · ')}</span>` : ''}</div>`
      }
      const attribLine = [name, attribBits].filter(Boolean).join(', ')
      const rel = l('relationship')
      return `<div class="ve-item ve-rec">
        <div class="ve-rec-quote">${rich('text')}</div>
        <div class="ve-rec-attrib">— ${attribLine}${rel ? ` <span class="ve-meta-inline">(${rel})</span>` : ''}${d ? ` <span class="ve-meta-inline">· ${d}</span>` : ''}</div>
      </div>`
    }
    case 'references':
      if (!it.include_in_exports) return ''
      if (isSummary) {
        return `<div class="ve-item ve-item-line"><strong>${escapeHtml(it.name as string)}</strong>${[escapeHtml(it.title as string), escapeHtml(it.company as string)].filter(Boolean).length ? ` <span class="ve-meta-inline">— ${[escapeHtml(it.title as string), escapeHtml(it.company as string)].filter(Boolean).join(', ')}</span>` : ''}</div>`
      }
      return `<div class="ve-item">
        <h3>${escapeHtml(it.name as string)}</h3>
        <div class="ve-meta">${metaLine([escapeHtml(it.title as string), escapeHtml(it.company as string)])}</div>
      </div>`
    default:
      return ''
  }
}

/**
 * Build the per-section style classes that the global CSS targets.
 * Each section gets a unique class — `ve-sec-{key}` — so we can override
 * dividers/density without touching the global rules.
 */
function sectionStyleCss(secKey: string, resolved: ResolvedSectionStyle, baseTokens: StyleTokens): string {
  const sec = DEFAULT_VIEW_STYLE === DEFAULT_VIEW_STYLE  // tree-shaking-safe noop
  void sec
  const tokens = deriveTokens(resolved)
  const showDivider = resolved.item_divider ?? true
  return `
    .ve-sec-${secKey} .ve-item {
      margin-bottom: ${tokens.itemGapPx}px;
      padding-bottom: ${showDivider ? tokens.itemGapPx : 0}px;
      border-bottom: ${showDivider ? `1px solid ${baseTokens.accentCss}1A` : 'none'};
      line-height: ${tokens.lineHeight};
    }
    .ve-sec-${secKey} .ve-item:last-child { border-bottom: none; padding-bottom: 0; margin-bottom: 0; }
  `
}

export function buildViewHtml(store: ResumeStore, view: ResumeView, locale: string): string {
  const r = store.resume
  if (!r) return '<p>No resume data</p>'

  const viewStyle = withDefaults(view.style)
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
      }
    })
    .filter((s) => s.detail !== 'off')
    .sort((a, b) => a.sort_order - b.sort_order)

  const perSectionCss: string[] = []
  const sectionsHtml = enabledSections
    .map((s) => {
      if (!s.storeKey) return ''
      // Virtual promoted_projects derives its items from the starred projects;
      // every other section reads its filtered store array.
      const items = s.key === 'promoted_projects'
        ? promotedProjectItems(store, view)
        : (filtered[s.storeKey] as unknown[])
      if (!items.length) return ''
      const resolved = resolveSectionStyle(viewStyle, s.sectionStyle)
      perSectionCss.push(sectionStyleCss(s.key, resolved, tokens))
      const ctx: RenderCtx = { locale, detail: s.detail, style: resolved }
      const renderKey = renderKeyFor(s.key)
      const itemsHtml = items.map((item) => renderItem(renderKey, item, ctx)).filter(Boolean).join('\n')
      if (!itemsHtml) return ''
      // s.label is a hardcoded constant from SECTIONS, but escape defensively.
      const heading = resolved.hide_heading ? '' : `<h2>${escapeHtml(s.label)}</h2>`
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
  const nameStyleCss = `font-family:${resolveFontCss(header.name_style.font)};font-size:${nameSizePt}pt;`
  const titleStyleCss = `font-family:${resolveFontCss(header.title_style.font)};font-size:${titleSizePt}pt;`

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

  const titleText = escapeHtml(lc(r.title))
  const photoImg = showPhoto ? `<img class="ve-photo" src="${escapeHtml(photoSrc!)}" alt="">` : ''
  const identityHtml = `<div class="ve-identity">
    <h1 class="ve-name" style="${nameStyleCss}">${escapeHtml(r.full_name)}</h1>
    ${titleText ? `<div class="ve-header-title" style="${titleStyleCss}">${titleText}</div>` : ''}
    ${contactHtml ? `<div class="ve-header-contact">${contactHtml}</div>` : ''}
  </div>`
  const headerInner = header.photo_placement === 'below'
    ? `${identityHtml}${photoImg}`
    : `${photoImg}${identityHtml}`
  const logoHtml = showLogo
    ? `<div class="ve-logo-banner ve-logo-${header.logo_placement}"><img class="ve-logo" src="${escapeHtml(logoSrc!)}" alt=""></div>`
    : ''

  // ── Footer (closing visual) ───────────────────────────────────────────────
  const copyright = escapeHtml(buildCopyrightLine(footer, r, new Date().getFullYear(), locale))
  const footerNote = escapeHtml(lc(footer.note))
  const footerText = [copyright, footerNote].filter(Boolean).join('  ·  ')
  const showFooter = footer.separator !== 'none' || !!footerText
  const footerHtml = showFooter
    ? `<footer class="ve-footer ve-footer-${footer.separator}">${footerText ? `<div class="ve-copyright">${footerText}</div>` : ''}</footer>`
    : ''

  // Restrictive CSP: blocks any script execution inside the generated document
  // (defence in depth — the escape-at-render above is the primary defence).
  // The print popup still works because window.print() is called from the
  // parent window, not from a script inside the document.
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')

  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>${escapeHtml(view.name)} — ${escapeHtml(r.full_name)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Open+Sans+Condensed:wght@300&family=Ubuntu:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${tokens.bodyFontCss}; font-size: ${tokens.bodyFontSizePt}pt; color: #111111; line-height: ${tokens.lineHeight};
           padding: ${tokens.pagePadCss}; max-width: 820px; margin: 0 auto; }
    h1  { font-family: ${tokens.headingFontCss}; font-weight: 300; font-size: ${tokens.h1Pt}pt;
           color: ${tokens.accentCss}; margin-bottom: 4px; }
    h2  { font-family: ${tokens.headingFontCss}; font-weight: 300; font-size: ${tokens.h2Pt}pt;
           color: ${tokens.accentCss}; border-bottom: 1.5px solid ${tokens.accentCss}33; padding-bottom: 5px;
           margin: ${tokens.itemGapPx * 2}px 0 ${tokens.sectionHeadingAfterPx}px; }
    h3  { font-size: ${tokens.h3Pt}pt; font-weight: 600; color: ${tokens.accentCss}; margin-bottom: 3px; }
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
    .ve-identity { min-width: 0; }
    .ve-photo {
      width: 112px; height: 112px; object-fit: cover; border-radius: 8px;
      flex-shrink: 0; border: 1px solid ${tokens.accentCss}22;
    }
    /* Footer */
    .ve-footer { margin-top: 28px; padding-top: 12px; }
    .ve-footer-line   { border-top: 1px solid ${tokens.accentCss}66; }
    .ve-footer-double { border-top: 3px double ${tokens.accentCss}88; }
    .ve-footer-dotted { border-top: 2px dotted ${tokens.accentCss}66; }
    .ve-footer-dashed { border-top: 2px dashed ${tokens.accentCss}66; }
    .ve-footer-thick  { border-top: 3px solid ${tokens.accentCss}; }
    .ve-copyright { text-align: center; font-size: ${tokens.metaFontSizePt}pt; color: #9097A1; margin-top: 8px; }
    .ve-intro { background: ${tokens.accentCss}10; border-left: 3px solid ${tokens.accentCss};
                padding: 12px 18px; margin: 20px 0; font-size: ${tokens.smallFontSizePt}pt; white-space: pre-line; }
    .ve-section { margin-bottom: 8px; }
    .ve-item { margin-bottom: ${tokens.itemGapPx}px; padding-bottom: ${tokens.itemGapPx}px; border-bottom: 1px solid ${tokens.accentCss}1A; }
    .ve-item:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .ve-item-line { padding-bottom: 0; border-bottom: none; margin-bottom: 4px; font-size: ${tokens.smallFontSizePt}pt; }
    .ve-meta-inline { color: #6B7280; }
    .ve-inline { display: inline-block; margin-right: 20px; }
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
