/**
 * Resume Studio — DOCX export
 *
 * Renders a ResumeView as a .docx file using the `docx` library. The view
 * filter (lib/viewFilter) is applied first to drop hidden sections, excluded
 * items and (optionally) non-starred items; this exporter then walks the
 * surviving content in the view's section order and emits one paragraph
 * stream that mirrors the structure of the PDF export in buildViewHtml().
 *
 * Styling is hardcoded to the Cartavio brand to match the PDF output —
 * navy headings, Ubuntu body, A4. The exporter does NOT honour
 * view.template_id (no template system yet; the field is reserved).
 *
 * This module is intentionally heavy (~400 kB of docx) so it should be
 * lazy-imported by the caller, e.g.:
 *   const { exportDocx } = await import('./exporter')
 */

import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  PageOrientation, convertInchesToTwip, BorderStyle,
} from 'docx'
import type {
  ResumeStore, ResumeView, LocalizedString,
} from '../types'
import { SECTIONS } from './sections'
import { resolve, fmtRange, fmtDate } from './locales'
import { applyView } from './viewFilter'

// ─── Brand constants (mirror Cartavio brand used by the HTML export) ─────────
const ACCENT_HEX = '002E6E'     // Cartavio navy
const SUBTLE_HEX = '666666'
const FAINT_HEX  = '888888'
const HEADING_FONT = 'Open Sans Condensed'
const BODY_FONT    = 'Ubuntu'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function L(ls: LocalizedString | undefined, locale: string): string {
  return resolve(ls, locale)
}

interface PStyle { italic?: boolean; bold?: boolean; color?: string; after?: number; before?: number }

function para(text: string, opts: PStyle = {}): Paragraph {
  return new Paragraph({
    spacing: { before: opts.before, after: opts.after ?? 60 },
    children: [new TextRun({ text, italics: opts.italic, bold: opts.bold, color: opts.color, font: BODY_FONT })],
  })
}

function sectionHeading(label: string): Paragraph {
  return new Paragraph({
    spacing: { before: 320, after: 120 },
    border: { bottom: { color: ACCENT_HEX, space: 1, style: BorderStyle.SINGLE, size: 8 } },
    children: [new TextRun({
      text: label.toUpperCase(),
      bold: true, color: ACCENT_HEX, size: 22, font: HEADING_FONT,
    })],
  })
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Render a ResumeView to a .docx blob and trigger a browser download.
 * Caller decides the export locale (typically one of the resume's
 * supported_locales).
 */
export async function exportDocx(store: ResumeStore, view: ResumeView, locale: string): Promise<void> {
  const filtered = applyView(store, view)
  const children: Paragraph[] = []

  // ── Header (resume identity) ────────────────────────────────────────────
  const r = filtered.resume
  if (r) {
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: r.full_name, bold: true, size: 56, font: HEADING_FONT, color: ACCENT_HEX })],
    }))
    const titleText = L(r.title, locale)
    if (titleText) {
      children.push(new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: titleText, size: 28, font: HEADING_FONT, color: '444444' })],
      }))
    }
    const contactBits: string[] = []
    if (r.email)           contactBits.push(r.email)
    if (r.phone)           contactBits.push(r.phone)
    if (r.linkedin_url)    contactBits.push(r.linkedin_url)
    if (r.website_url)     contactBits.push(r.website_url)
    if (contactBits.length) {
      children.push(new Paragraph({
        spacing: { after: 220 },
        children: [new TextRun({ text: contactBits.join('  •  '), size: 18, color: SUBTLE_HEX, font: BODY_FONT })],
      }))
    }
  }

  // ── Introduction (view-specific) ────────────────────────────────────────
  const intro = L(view.introduction, locale)
  if (intro) {
    children.push(new Paragraph({
      spacing: { before: 80, after: 220 },
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: intro, italics: true, font: BODY_FONT, color: '333333' })],
    }))
  }

  // ── Content sections in the view's chosen order ─────────────────────────
  const contentSections = SECTIONS.filter((s) => s.storeKey && s.key !== 'views')
  const enabledSections = contentSections
    .map((s) => {
      const vs = view.sections.find((v) => v.key === s.key)
      return { ...s, sort_order: vs?.sort_order ?? 999, enabled: vs?.enabled ?? true }
    })
    .filter((s) => s.enabled)
    .sort((a, b) => a.sort_order - b.sort_order)

  for (const def of enabledSections) {
    if (!def.storeKey) continue
    const items = filtered[def.storeKey] as unknown[]
    if (!items.length) continue
    const block = renderSection(def.key, def.label, items, locale)
    if (block.length) children.push(...block)
  }

  // ── Page setup — A4 with comfortable margins ────────────────────────────
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: BODY_FONT, size: 22 } },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.PORTRAIT, width: 11906, height: 16838 }, // A4
          margin: {
            top:    convertInchesToTwip(0.75),
            bottom: convertInchesToTwip(0.75),
            left:   convertInchesToTwip(0.85),
            right:  convertInchesToTwip(0.85),
          },
        },
      },
      children,
    }],
  })

  const blob = await Packer.toBlob(doc)
  const slugName = (store.resume?.full_name || 'resume').replace(/\s+/g, '_')
  const slugView = view.name.replace(/\s+/g, '_')
  downloadBlob(blob, `${slugName}_${slugView}.docx`)
}

// ─── Section dispatcher ───────────────────────────────────────────────────────

function renderSection(key: string, label: string, items: unknown[], locale: string): Paragraph[] {
  switch (key) {
    case 'key_qualifications':    return wrap(label, renderKQs(items, locale))
    case 'projects':              return wrap(label, renderProjects(items, locale))
    case 'work_experiences':      return wrap(label, renderWork(items, locale))
    case 'educations':            return wrap(label, renderEducations(items, locale))
    case 'courses':               return wrap(label, renderCourses(items, locale))
    case 'certifications':        return wrap(label, renderCertifications(items, locale))
    case 'technology_categories': return wrap(label, renderTechCategories(items, locale))
    case 'spoken_languages':      return wrap(label, renderLanguages(items, locale))
    case 'positions':             return wrap(label, renderPositions(items, locale))
    case 'presentations':         return wrap(label, renderPresentations(items, locale))
    case 'publications':          return wrap(label, renderPublications(items, locale))
    case 'honor_awards':          return wrap(label, renderAwards(items, locale))
    case 'references':            return wrap(label, renderReferences(items, locale))
    case 'skills':                return []  // skill registry never exported directly
    case 'roles':                 return []  // role registry never exported directly
    default:                      return []
  }
}

function wrap(label: string, body: Paragraph[]): Paragraph[] {
  if (!body.length) return []
  return [sectionHeading(label), ...body]
}

// ─── Per-section renderers (typed inline to avoid coupling to type names) ───

type AnyItem = Record<string, unknown>
type YM = { year: number; month: number | null } | null

const ls = (it: AnyItem, field: string, locale: string): string =>
  resolve(it[field] as LocalizedString | undefined, locale)

function renderKQs(items: unknown[], locale: string): Paragraph[] {
  const out: Paragraph[] = []
  for (const k of items as AnyItem[]) {
    const tag     = ls(k, 'tag_line', locale)
    const summary = ls(k, 'summary',  locale)
    if (tag)     out.push(para(tag, { italic: true, after: 80 }))
    if (summary) out.push(para(summary, { after: 120 }))
    const points = (k.key_points as Array<AnyItem & { disabled?: boolean }> | undefined) ?? []
    for (const kp of points) {
      if (kp.disabled) continue
      const name = ls(kp, 'name', locale)
      const desc = ls(kp, 'long_description', locale)
      if (!name && !desc) continue
      out.push(new Paragraph({
        spacing: { after: 60 },
        children: [
          ...(name ? [new TextRun({ text: `• ${name}`, bold: true, font: BODY_FONT })] : []),
          ...(name && desc ? [new TextRun({ text: ' — ', font: BODY_FONT })] : []),
          ...(desc ? [new TextRun({ text: desc, font: BODY_FONT })] : []),
        ],
      }))
    }
  }
  return out
}

function renderProjects(items: unknown[], locale: string): Paragraph[] {
  const out: Paragraph[] = []
  const sorted = [...items as AnyItem[]].sort(byStartDescending)
  for (const p of sorted) {
    const customer = p.use_anonymized ? ls(p, 'customer_anonymized', locale) : ls(p, 'customer', locale)
    const title = customer || ls(p, 'description', locale) || 'Project'
    const dateStr = fmtRange(p.start as YM, p.end as YM)
    out.push(new Paragraph({
      spacing: { before: 200, after: 40 },
      children: [
        new TextRun({ text: title, bold: true, size: 24, font: BODY_FONT }),
        ...(dateStr ? [new TextRun({ text: `   ${dateStr}`, size: 20, color: FAINT_HEX, font: BODY_FONT })] : []),
      ],
    }))
    const sub: string[] = []
    const roleNames = ((p.roles as Array<AnyItem & { disabled?: boolean }> | undefined) ?? [])
      .filter((role) => !role.disabled)
      .map((role) => ls(role, 'name', locale))
      .filter(Boolean)
    if (roleNames.length)           sub.push(roleNames.join(', '))
    if (ls(p, 'industry', locale))  sub.push(ls(p, 'industry', locale))
    if (p.team_size)                sub.push(`Team of ${p.team_size as number}`)
    if (p.percent_allocated)        sub.push(`${p.percent_allocated as number}% allocation`)
    if (sub.length) out.push(para(sub.join(' · '), { italic: true, color: SUBTLE_HEX, after: 80 }))

    const shortDesc = ls(p, 'description', locale)
    const longDesc  = ls(p, 'long_description', locale)
    if (shortDesc && shortDesc !== title)       out.push(para(shortDesc, { after: 80 }))
    if (longDesc)                                out.push(para(longDesc,  { after: 100 }))

    const highlights = (p.highlights as LocalizedString[] | undefined) ?? []
    for (const h of highlights) {
      const txt = resolve(h, locale)
      if (txt) out.push(para(`• ${txt}`, { after: 40 }))
    }

    const skills = (p.skills as AnyItem[] | undefined) ?? []
    const skillNames = skills.map((s) => ls(s, 'name', locale)).filter(Boolean)
    if (skillNames.length) {
      out.push(new Paragraph({
        spacing: { before: 60, after: 100 },
        children: [
          new TextRun({ text: 'Skills: ', italics: true, color: SUBTLE_HEX, font: BODY_FONT }),
          new TextRun({ text: skillNames.join(', '),   color: SUBTLE_HEX, font: BODY_FONT }),
        ],
      }))
    }
  }
  return out
}

function renderWork(items: unknown[], locale: string): Paragraph[] {
  const out: Paragraph[] = []
  const sorted = [...items as AnyItem[]].sort(byStartDescending)
  for (const w of sorted) {
    const employer = ls(w, 'employer', locale)
    const role     = ls(w, 'role_title', locale)
    const title = [employer, role].filter(Boolean).join(' — ')
    const dateStr = fmtRange(w.start as YM, w.end as YM)
    out.push(new Paragraph({
      spacing: { before: 180, after: 40 },
      children: [
        new TextRun({ text: title, bold: true, size: 24, font: BODY_FONT }),
        ...(dateStr ? [new TextRun({ text: `   ${dateStr}`, size: 20, color: FAINT_HEX, font: BODY_FONT })] : []),
      ],
    }))
    if (w.employment_type) {
      out.push(para(String(w.employment_type).replace('_', ' '), { italic: true, color: SUBTLE_HEX, after: 80 }))
    }
    const longDesc = ls(w, 'long_description', locale)
    if (longDesc) out.push(para(longDesc, { after: 80 }))
  }
  return out
}

function renderEducations(items: unknown[], locale: string): Paragraph[] {
  const out: Paragraph[] = []
  for (const e of items as AnyItem[]) {
    const school = ls(e, 'school', locale)
    const degree = ls(e, 'degree', locale)
    const dateStr = fmtRange(e.start as YM, e.end as YM)
    out.push(new Paragraph({
      spacing: { before: 140, after: 30 },
      children: [
        new TextRun({ text: school, bold: true, font: BODY_FONT }),
        ...(degree  ? [new TextRun({ text: ` — ${degree}`, font: BODY_FONT })] : []),
        ...(dateStr ? [new TextRun({ text: `   ${dateStr}`, color: FAINT_HEX, font: BODY_FONT })] : []),
      ],
    }))
    const desc = ls(e, 'description', locale)
    if (desc)    out.push(para(desc, { after: 40 }))
    if (e.grade) out.push(para(`Grade: ${e.grade as string}`, { italic: true, color: SUBTLE_HEX, after: 40 }))
  }
  return out
}

function renderCourses(items: unknown[], locale: string): Paragraph[] {
  const out: Paragraph[] = []
  for (const c of items as AnyItem[]) {
    const name    = ls(c, 'name', locale)
    const program = ls(c, 'program', locale)
    out.push(new Paragraph({
      spacing: { after: 30 },
      children: [
        new TextRun({ text: name, bold: true, font: BODY_FONT }),
        ...(program ? [new TextRun({ text: ` — ${program}`, font: BODY_FONT })] : []),
        ...(c.completed ? [new TextRun({ text: `   ${fmtDate(c.completed as YM)}`, color: FAINT_HEX, font: BODY_FONT })] : []),
      ],
    }))
    const desc = ls(c, 'description', locale)
    if (desc) out.push(para(desc, { after: 50 }))
  }
  return out
}

function renderCertifications(items: unknown[], locale: string): Paragraph[] {
  const out: Paragraph[] = []
  for (const c of items as AnyItem[]) {
    const name      = ls(c, 'name', locale)
    const organiser = ls(c, 'organiser', locale)
    const expires   = c.expires ? ` (expires ${fmtDate(c.expires as YM)})` : ''
    out.push(new Paragraph({
      spacing: { after: 50 },
      children: [
        new TextRun({ text: name, bold: true, font: BODY_FONT }),
        ...(organiser ? [new TextRun({ text: ` — ${organiser}`, font: BODY_FONT })] : []),
        ...(c.issued  ? [new TextRun({ text: `   ${fmtDate(c.issued as YM)}${expires}`, color: FAINT_HEX, font: BODY_FONT })] : []),
      ],
    }))
    if (c.credential_url) out.push(para(c.credential_url as string, { color: SUBTLE_HEX, after: 30 }))
  }
  return out
}

function renderTechCategories(items: unknown[], locale: string): Paragraph[] {
  const out: Paragraph[] = []
  for (const cat of items as AnyItem[]) {
    const catName = ls(cat, 'name', locale)
    const skills  = (cat.skills as AnyItem[] | undefined) ?? []
    const names   = skills.map((s) => ls(s, 'name', locale)).filter(Boolean)
    if (!catName && !names.length) continue
    out.push(new Paragraph({
      spacing: { after: 60 },
      children: [
        ...(catName ? [new TextRun({ text: `${catName}: `, bold: true, font: BODY_FONT })] : []),
        new TextRun({ text: names.join(', '), font: BODY_FONT }),
      ],
    }))
  }
  return out
}

function renderLanguages(items: unknown[], locale: string): Paragraph[] {
  const out: Paragraph[] = []
  for (const l of items as AnyItem[]) {
    const name  = ls(l, 'name', locale)
    const level = ls(l, 'level', locale)
    out.push(new Paragraph({
      spacing: { after: 30 },
      children: [
        new TextRun({ text: name, bold: true, font: BODY_FONT }),
        ...(level ? [new TextRun({ text: ` — ${level}`, font: BODY_FONT })] : []),
      ],
    }))
  }
  return out
}

function renderPositions(items: unknown[], locale: string): Paragraph[] {
  const out: Paragraph[] = []
  for (const p of items as AnyItem[]) {
    const name = ls(p, 'name', locale)
    const org  = ls(p, 'organisation', locale)
    const dateStr = fmtRange(p.start as YM, p.end as YM)
    out.push(new Paragraph({
      spacing: { after: 30 },
      children: [
        new TextRun({ text: name, bold: true, font: BODY_FONT }),
        ...(org     ? [new TextRun({ text: ` — ${org}`, font: BODY_FONT })] : []),
        ...(dateStr ? [new TextRun({ text: `   ${dateStr}`, color: FAINT_HEX, font: BODY_FONT })] : []),
      ],
    }))
    const desc = ls(p, 'description', locale)
    if (desc) out.push(para(desc, { after: 50 }))
  }
  return out
}

function renderPresentations(items: unknown[], locale: string): Paragraph[] {
  const out: Paragraph[] = []
  for (const p of items as AnyItem[]) {
    const title = ls(p, 'title', locale)
    const event = ls(p, 'event', locale)
    out.push(new Paragraph({
      spacing: { after: 30 },
      children: [
        new TextRun({ text: title, bold: true, font: BODY_FONT }),
        ...(event ? [new TextRun({ text: ` — ${event}`, font: BODY_FONT })] : []),
        ...(p.date ? [new TextRun({ text: `   ${fmtDate(p.date as YM)}`, color: FAINT_HEX, font: BODY_FONT })] : []),
      ],
    }))
    const desc = ls(p, 'description', locale)
    if (desc)   out.push(para(desc, { after: 30 }))
    if (p.url)  out.push(para(p.url as string, { color: SUBTLE_HEX, after: 40 }))
  }
  return out
}

function renderPublications(items: unknown[], locale: string): Paragraph[] {
  const out: Paragraph[] = []
  for (const p of items as AnyItem[]) {
    const title     = ls(p, 'title', locale)
    const publisher = ls(p, 'publisher', locale)
    out.push(new Paragraph({
      spacing: { after: 30 },
      children: [
        new TextRun({ text: title, bold: true, font: BODY_FONT }),
        ...(publisher ? [new TextRun({ text: ` — ${publisher}`, font: BODY_FONT })] : []),
        ...(p.date    ? [new TextRun({ text: `   ${fmtDate(p.date as YM)}`, color: FAINT_HEX, font: BODY_FONT })] : []),
      ],
    }))
    const abstract = ls(p, 'abstract', locale)
    if (abstract) out.push(para(abstract, { after: 30 }))
    if (p.url)    out.push(para(p.url as string, { color: SUBTLE_HEX, after: 40 }))
  }
  return out
}

function renderAwards(items: unknown[], locale: string): Paragraph[] {
  const out: Paragraph[] = []
  for (const a of items as AnyItem[]) {
    const name   = ls(a, 'name', locale)
    const issuer = ls(a, 'issuer', locale)
    out.push(new Paragraph({
      spacing: { after: 30 },
      children: [
        new TextRun({ text: name, bold: true, font: BODY_FONT }),
        ...(issuer ? [new TextRun({ text: ` — ${issuer}`, font: BODY_FONT })] : []),
        ...(a.date ? [new TextRun({ text: `   ${fmtDate(a.date as YM)}`, color: FAINT_HEX, font: BODY_FONT })] : []),
      ],
    }))
    const desc = ls(a, 'description', locale)
    if (desc) out.push(para(desc, { after: 50 }))
  }
  return out
}

function renderReferences(items: unknown[], locale: string): Paragraph[] {
  const out: Paragraph[] = []
  for (const ref of items as AnyItem[]) {
    if (!ref.include_in_exports) continue
    const head: TextRun[] = []
    if (ref.name)    head.push(new TextRun({ text: String(ref.name),         bold: true, font: BODY_FONT }))
    if (ref.title)   head.push(new TextRun({ text: `, ${ref.title as string}`,             font: BODY_FONT }))
    if (ref.company) head.push(new TextRun({ text: `, ${ref.company as string}`,           font: BODY_FONT }))
    if (head.length) out.push(new Paragraph({ spacing: { after: 30 }, children: head }))
    const ctx: string[] = []
    const rel = ls(ref, 'relationship', locale)
    if (rel)       ctx.push(rel)
    if (ref.email) ctx.push(String(ref.email))
    if (ref.phone) ctx.push(String(ref.phone))
    if (ctx.length) out.push(para(ctx.join(' · '), { color: SUBTLE_HEX, after: 50 }))
  }
  return out
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

function byStartDescending(a: AnyItem, b: AnyItem): number {
  const aS = a.start as YM
  const bS = b.start as YM
  const aD = aS ? aS.year * 12 + (aS.month ?? 0) : 0
  const bD = bS ? bS.year * 12 + (bS.month ?? 0) : 0
  return bD - aD
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 100)
}
