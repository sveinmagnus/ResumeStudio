/**
 * PURE: ATS-friendly plain-text and Markdown exports (roadmap F6).
 *
 * A third render adapter over the section catalog (lib/sectionCatalog.ts),
 * beside the HTML and DOCX paths: same applyView filtering, same enabled-
 * section order, but emitting clean UTF-8 text / Markdown — no tables, no
 * columns — the shapes ATS parsers and online application forms want. Also
 * the paste-into-LinkedIn/email format.
 *
 * Output is text, not HTML: nothing here is interpolated into markup, so no
 * escaping applies. Do not repurpose these strings into an HTML context.
 */

import type { ResumeStore, ResumeView, LocalizedString } from '../types'
import { SECTIONS, localizedSectionHeading } from './sections'
import {
  applyView, isExportableSection, defaultViewDetail, promotedProjectItems,
} from './viewFilter'
import { SECTION_CATALOG, summaryTitleMeta, type CatalogCtx, type ItemView } from './sectionCatalog'
import { skillMatrixRows, fmtLastUsed, fmtProficiency } from './skillMatrix'
import { xs, fmtYears } from './exportStrings'
import { showcaseGroups } from './showcase'
import { sortItems } from './sectionSort'
import { resolveSectionStyle, sectionHeadingText, kqVisibility, bulletGlyph, withDefaults } from './viewStyle'
import { withHeaderDefaults, withFooterDefaults, buildHeaderLines, buildCopyrightLine } from './viewHeader'
import { parseRichBlocks, type RichRun } from './richText'
import { resolve } from './locales'

type Format = 'text' | 'markdown'

// ─── Rich text → lines ────────────────────────────────────────────────────────

function runText(r: RichRun, fmt: Format): string {
  if (fmt === 'text') return r.text
  let t = r.text
  if (r.bold) t = `**${t}**`
  if (r.italic) t = `*${t}*`
  return t
}

/** Flatten allowlisted rich text into plain/markdown lines (lists become dashes). */
function richToLines(html: string, fmt: Format): string[] {
  return parseRichBlocks(html)
    .map((b) => {
      const text = b.runs.map((r) => runText(r, fmt)).join('')
      if (b.kind === 'paragraph') return text
      const indent = '  '.repeat(b.level ?? 0)
      return `${indent}${b.ordered ? `${b.index}. ` : '- '}${text}`
    })
    .filter((t) => t.trim() !== '')
}

// ─── Item rendering ───────────────────────────────────────────────────────────

function summaryLine(title: string, meta: string, sep: '—' | ':', fmt: Format): string {
  const t = fmt === 'markdown' ? `**${title}**` : title
  if (!meta) return `- ${t}`
  return sep === ':' ? `- ${t}: ${meta}` : `- ${t} — ${meta}`
}

function renderItemLines(v: ItemView, fmt: Format, bullet: string | null = null): string[] {
  const md = fmt === 'markdown'
  const lines: string[] = []
  // The catalog now keeps the date separate from `meta` (so the HTML preview can
  // reorder it); the linear text export just appends it to the details line.
  const metaTxt = [...v.meta, v.date].filter(Boolean).join(' · ')

  if (v.layout === 'inline') {
    lines.push(`${md ? `**${v.title}**` : v.title}${metaTxt ? ` — ${metaTxt}` : ''}`)
    return lines
  }

  if (v.layout === 'quote') {
    for (const l of richToLines(v.body, fmt)) lines.push(md ? `> ${l}` : `"${l}"`)
    const tail = [v.attribution, ...v.attributionMeta].filter(Boolean).join(' · ')
    if (tail) lines.push(`— ${tail}`)
    return lines
  }

  if (v.title) lines.push(md ? `### ${v.title}` : v.title)
  if (metaTxt) lines.push(md ? `*${metaTxt}*` : metaTxt)
  lines.push(...richToLines(v.body, fmt))
  for (const p of v.points) {
    const body = richToLines(p.body, 'text').join(' ')
    const label = p.label ? (md ? `**${p.label}**: ` : `${p.label}: `) : ''
    lines.push(`- ${label}${body}`)
  }
  if (v.tags.length) lines.push(`${v.tagsLabel || ''}${v.tags.join(', ')}`)

  // Plain-text bullets: prefix the first line with the glyph and hang-indent the
  // rest so they line up under the heading. Markdown keeps its own structure
  // (a glyph before `### Title` would break the heading), so it's text-only.
  if (bullet && fmt === 'text' && lines.length) {
    return [`${bullet} ${lines[0]}`, ...lines.slice(1).map((l) => `  ${l}`)]
  }
  return lines
}

// ─── Document assembly ────────────────────────────────────────────────────────

function buildViewDoc(store: ResumeStore, view: ResumeView, locale: string, fmt: Format): string {
  const md = fmt === 'markdown'
  const r = store.resume
  if (!r) return ''

  const viewStyle = withDefaults(view.style)
  const header = withHeaderDefaults(view.header)
  const footer = withFooterDefaults(view.footer)
  const filtered = applyView(store, view)
  const out: string[] = []

  // ── Identity + contact ────────────────────────────────────────────────────
  out.push(md ? `# ${r.full_name}` : r.full_name.toUpperCase())
  const title = resolve(header.title_override, locale) || resolve(r.title, locale)
  if (title) out.push(md ? `*${title}*` : title)
  for (const line of buildHeaderLines(header, r, store, locale)) {
    out.push(line.map((s) => `${s.label ?? ''}${s.value}`).join(header.separator))
  }
  out.push('')

  // ── Introduction ──────────────────────────────────────────────────────────
  const intro = resolve(view.introduction, locale)
  if (intro) { out.push(intro); out.push('') }

  // ── Sections in the view's order (same walk as the HTML/DOCX adapters) ────
  const enabled = SECTIONS.filter(isExportableSection)
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

  for (const s of enabled) {
    if (!s.storeKey) continue
    // Synthetic skill matrix: rows, not items. Markdown gets a real table;
    // plain text gets dash lines (ATS parsers dislike column art).
    if (s.key === 'skill_matrix') {
      const resolved = resolveSectionStyle(viewStyle, s.sectionStyle)
      const rows = skillMatrixRows(store, view, locale, { highlightedOnly: s.detail === 'summary' })
      if (!rows.length) continue
      const showCategory = rows.some((r) => r.category)
      const showDates = !resolved.hide_dates
      const heading = resolved.hide_heading ? '' : sectionHeadingText(resolved, localizedSectionHeading(s.key, locale), locale)
      if (md) {
        if (heading) out.push(`## ${heading}`)
        const cols = [
          xs('matrix_skill', locale),
          ...(showCategory ? [xs('matrix_category', locale)] : []),
          xs('matrix_experience', locale),
          xs('matrix_proficiency', locale),
          ...(showDates ? [xs('matrix_last_used', locale)] : []),
        ]
        out.push(`| ${cols.join(' | ')} |`)
        out.push(`| ${cols.map(() => '---').join(' | ')} |`)
        for (const r of rows) {
          const cells = [r.name, ...(showCategory ? [r.category] : []), fmtYears(r.years, locale), fmtProficiency(r.proficiency), ...(showDates ? [fmtLastUsed(r, locale, resolved.date_format)] : [])]
          out.push(`| ${cells.join(' | ')} |`)
        }
      } else {
        if (heading) { out.push(heading.toUpperCase()); out.push('-'.repeat(Math.max(4, heading.length))) }
        for (const r of rows) {
          out.push(['- ' + r.name, showCategory ? r.category : '', fmtYears(r.years, locale), fmtProficiency(r.proficiency), showDates ? fmtLastUsed(r, locale, resolved.date_format) : '']
            .filter(Boolean).join(' — '))
        }
      }
      out.push('')
      continue
    }
    const rawItems = s.key === 'promoted_projects'
      ? promotedProjectItems(store, view)
      : s.key === 'technology_categories'
        ? showcaseGroups(store, view, locale)
        : (filtered[s.storeKey] as unknown[])
    if (!rawItems.length) continue
    const renderKey = s.key === 'promoted_projects' ? 'projects' : s.key
    const items = s.key === 'technology_categories'
      ? rawItems
      : sortItems(renderKey, rawItems as Array<{ id: string; sort_order: number }>, s.sort, locale)
    const desc = SECTION_CATALOG[renderKey]
    if (!desc || (!desc.full && !desc.summary)) continue
    const resolved = resolveSectionStyle(viewStyle, s.sectionStyle)
    const cctx: CatalogCtx = { locale, hideDates: !!resolved.hide_dates, dateFormat: resolved.date_format, target: 'html', kq: kqVisibility(resolved, s.detail === 'summary' ? 'summary' : 'full') }

    const body: string[] = []
    for (const item of items as Array<Record<string, unknown>>) {
      if (s.detail === 'summary' && !desc.alwaysFull) {
        const sum = desc.summary?.(item, cctx)
        if (sum) {
          const { title, meta } = summaryTitleMeta(sum)
          const short = resolve(item.short_description as LocalizedString | undefined, locale).trim()
          const below = !!short && resolved.short_desc_line !== 'inline'
          const metaStr = short && !below ? [meta.join(' · '), short].filter(Boolean).join(' — ') : meta.join(' · ')
          body.push(summaryLine(title, metaStr, sum.sep, fmt))
          if (below) body.push(md ? `  ${short}` : `  ${short}`)
        }
        continue
      }
      const v = desc.full?.(item, cctx)
      if (!v) continue
      const lines = renderItemLines(v, fmt, resolved.item_bullets ? bulletGlyph(resolved) : null)
      if (lines.length) { body.push(...lines); body.push('') }
    }
    while (body.length && body[body.length - 1] === '') body.pop()
    if (!body.length) continue

    const heading = resolved.hide_heading ? '' : sectionHeadingText(resolved, localizedSectionHeading(s.key, locale), locale)
    if (md) {
      if (heading) out.push(`## ${heading}`)
    } else if (heading) {
      out.push(heading.toUpperCase())
      out.push('-'.repeat(Math.max(4, heading.length)))
    }
    out.push(...body)
    out.push('')
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const copyright = buildCopyrightLine(footer, r, new Date().getFullYear(), locale)
  const note = resolve(footer.note, locale)
  const footerText = [copyright, note].filter(Boolean).join(' · ')
  if (footerText) out.push(md ? `---\n${footerText}` : footerText)

  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n') + '\n'
}

/** Plain-text export — UPPERCASE section headings, dash underlines, dash bullets. */
export function buildViewText(store: ResumeStore, view: ResumeView, locale: string): string {
  return buildViewDoc(store, view, locale, 'text')
}

/** Markdown export — #/##/### headings, bold/italic preserved from rich text. */
export function buildViewMarkdown(store: ResumeStore, view: ResumeView, locale: string): string {
  return buildViewDoc(store, view, locale, 'markdown')
}
