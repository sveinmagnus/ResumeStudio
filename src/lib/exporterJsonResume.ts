/**
 * Resume Studio — JSON Resume export (the round-trip half of importerJsonResume).
 *
 * Emits a JSON Resume v1.0.0 document (https://jsonresume.org/schema) for ONE
 * Resume View, mirroring exporterEuropass's posture: `applyView` runs first, so
 * a section switched off, an excluded item, a disabled row or a starred-only
 * view means exactly what it means in the PDF. Output is an object — the caller
 * stringifies and downloads it.
 *
 * SECURITY — anonymization: a project whose `use_anonymized` is set (or any
 * project under a `force_anonymized` view, which applyView rewrites) emits its
 * alias ONLY. There is no fallback to the real customer name — a project with
 * no alias simply omits `entity`, the same rule as sectionCatalog's
 * projectCustomer.
 *
 * Interchange hygiene: empty strings, empty arrays and empty sections are
 * omitted rather than emitted blank.
 */

import type {
  ResumeStore, ResumeView, Project, YearMonth,
} from '../types'
import { resolve } from './locales'
import { richToPlain } from './richText'
import { applyView, viewProfileTagLine, defaultViewDetail } from './viewFilter'
import { sortItems } from './sectionSort'
import { showcaseGroups } from './showcase'
import { skillMatrixRows } from './skillMatrix'
import { skillKey } from './skillExtract'
import { socialSiteName } from './socialSite'

export const JSON_RESUME_SCHEMA =
  'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json'

type Json = Record<string, unknown>

/** "YYYY-MM" / "YYYY" — the ISO 8601 prefix JSON Resume dates use. */
function isoDate(d: YearMonth | null): string | undefined {
  if (!d) return undefined
  return d.month == null ? String(d.year) : `${d.year}-${String(d.month).padStart(2, '0')}`
}

/** Drop empty strings, undefined/null and empty arrays from an entry. */
function compact(entry: Json): Json {
  const out: Json = {}
  for (const [k, v] of Object.entries(entry)) {
    if (v == null) continue
    if (typeof v === 'string' && !v) continue
    if (Array.isArray(v) && !v.length) continue
    out[k] = v
  }
  return out
}

/**
 * The exported customer name for a project — the anonymized alias when the
 * project asks for it, NEVER the real name as a fallback (sectionCatalog's
 * projectCustomer rule; regression-tested).
 */
function projectCustomer(p: Project, locale: string): string {
  const anon = p.use_anonymized ? resolve(p.customer_anonymized, locale) : ''
  return anon || (p.use_anonymized ? '' : resolve(p.customer, locale))
}

/** Our 0–5 proficiency → the free-text level the importer maps back. */
function levelOf(proficiency: number): string {
  if (proficiency >= 5) return 'Master'
  if (proficiency >= 4) return 'Advanced'
  if (proficiency >= 3) return 'Intermediate'
  if (proficiency >= 1) return 'Beginner'
  return ''
}

/** Flatten a rich-text field to interchange plain text. */
function plain(ls: Record<string, string>, locale: string): string {
  return richToPlain(resolve(ls, locale)).trim()
}

/** Render a Resume View as a JSON Resume v1.0.0 document object. */
export function buildJsonResume(
  store: ResumeStore, view: ResumeView, locale: string,
): Record<string, unknown> {
  const filtered = applyView(store, view)
  const r = filtered.resume

  /** Order a section's items by the view's own sort setting, like every other export path. */
  const sortBy = <T extends { id: string; sort_order: number }>(key: string, items: T[]): T[] =>
    sortItems(key, items, view.sections.find((s) => s.key === key)?.sort ?? view.style?.sort ?? 'custom', locale)

  const doc: Json = { $schema: JSON_RESUME_SCHEMA }

  // ── Basics ─────────────────────────────────────────────────────────────────
  if (r) {
    // Title resolution matches every header render path: the view's explicit
    // override, else the selected profile's tag line, else the master title.
    const label = resolve(view.header?.title_override, locale)
      || viewProfileTagLine(store, view, locale)
      || resolve(r.title, locale)
    // The summary follows the FILTERED profile, so a view that switches the
    // profile section off (or excludes the profile) exports no summary — the
    // tag-line label above deliberately still resolves, like the PDF header.
    const profile = filtered.key_qualifications[0]
    const city = resolve(r.place_of_residence, locale)
    const profiles: Json[] = []
    if (r.linkedin_url) profiles.push({ network: 'LinkedIn', url: r.linkedin_url })
    if (r.twitter) {
      // The slot holds ANY social profile now (the editor's "Other social
      // media URL"): a URL's network is the detected platform name
      // (lib/socialSite — the same detector the header label uses), while a
      // bare @handle, which has no other referent, keeps the historical
      // Twitter reading.
      const isUrl = /^https?:/i.test(r.twitter)
      const network = isUrl ? socialSiteName(r.twitter) ?? 'Social' : 'Twitter'
      profiles.push({ network, ...(isUrl ? { url: r.twitter } : { username: r.twitter }) })
    }
    const basics = compact({
      name: r.full_name,
      label,
      email: r.email,
      phone: r.phone ?? '',
      url: r.website_url ?? '',
      summary: profile ? plain(profile.summary, locale) : '',
      ...(city ? { location: { city } } : {}),
      profiles,
    })
    if (Object.keys(basics).length) doc.basics = basics
  }

  // ── Sections ───────────────────────────────────────────────────────────────
  const work = sortBy('work_experiences', filtered.work_experiences).map((w) => compact({
    name: resolve(w.employer, locale),
    position: resolve(w.role_title, locale),
    url: w.company_url ?? '',
    summary: plain(w.long_description, locale) || plain(w.description, locale),
    startDate: isoDate(w.start),
    // `end: null` means ongoing everywhere in the data model → no endDate.
    endDate: isoDate(w.end),
  }))

  const volunteer = sortBy('positions', filtered.positions).map((v) => compact({
    organization: resolve(v.organisation, locale),
    position: resolve(v.name, locale),
    summary: plain(v.description, locale),
    startDate: isoDate(v.start),
    endDate: isoDate(v.end),
  }))

  const education = sortBy('educations', filtered.educations).map((e) => compact({
    institution: resolve(e.school, locale),
    studyType: resolve(e.degree, locale),
    score: e.grade ?? '',
    startDate: isoDate(e.start),
    endDate: isoDate(e.end),
  }))

  const awards = sortBy('honor_awards', filtered.honor_awards).map((a) => compact({
    title: resolve(a.name, locale),
    awarder: resolve(a.issuer, locale),
    summary: plain(a.description, locale),
    date: isoDate(a.date),
  }))

  const certificates = sortBy('certifications', filtered.certifications).map((c) => compact({
    name: resolve(c.name, locale),
    issuer: resolve(c.organiser, locale),
    date: isoDate(c.issued),
    url: c.credential_url ?? '',
  }))

  const publications = sortBy('publications', filtered.publications).map((p) => compact({
    name: resolve(p.title, locale),
    publisher: resolve(p.publisher, locale),
    releaseDate: isoDate(p.date),
    url: p.url ?? '',
    summary: plain(p.abstract, locale),
  }))

  // The view decides which skills ship, exactly as it does for the paged
  // exports: the Skills Showcase contributes its category groups (the inverse
  // of the importer's keywords rule) and the Skill Matrix its rows. Both off =
  // no skills section. Emitting the raw registry instead would ship every
  // skill on every view — more than any other target shows, and on an
  // anonymized view a skill named after a client would ride along.
  const detailOf = (key: string): string =>
    view.sections.find((s) => s.key === key)?.detail ?? defaultViewDetail(key)
  const skills: Json[] = []
  const seenSkill = new Set<string>()
  if (detailOf('technology_categories') !== 'off') {
    for (const g of showcaseGroups(store, view, locale)) {
      const keywords = g.skills.map((s) => resolve(s.name, locale)).filter(Boolean)
      for (const n of keywords) seenSkill.add(skillKey(n))
      if (keywords.length) skills.push(compact({ name: resolve(g.name, locale), keywords }))
    }
  }
  const matrixDetail = detailOf('skill_matrix')
  if (matrixDetail !== 'off') {
    for (const row of skillMatrixRows(store, view, locale, { highlightedOnly: matrixDetail === 'summary' })) {
      const key = skillKey(row.name)
      if (!key || seenSkill.has(key)) continue
      seenSkill.add(key)
      skills.push(compact({ name: row.name, level: levelOf(row.proficiency) }))
    }
  }

  const languages = sortBy('spoken_languages', filtered.spoken_languages)
    .filter((l) => resolve(l.name, locale).trim())
    .map((l) => compact({
      language: resolve(l.name, locale),
      fluency: resolve(l.level, locale),
    }))

  const projects = sortBy('projects', filtered.projects).map((p) => {
    const entity = projectCustomer(p, locale)
    return compact({
      // Name falls back through projectCustomer, never the raw customer, so an
      // anonymized project without an alias degrades rather than leaks.
      name: resolve(p.description, locale) || entity,
      description: plain(p.long_description, locale),
      entity,
      highlights: p.highlights.map((h) => resolve(h, locale)).filter(Boolean),
      keywords: p.skills.map((s) => resolve(s.name, locale)).filter(Boolean),
      roles: p.roles.filter((role) => !role.disabled)
        .map((role) => resolve(role.name, locale)).filter(Boolean),
      url: p.external_url ?? '',
      startDate: isoDate(p.start),
      endDate: isoDate(p.end),
    })
  })

  // Our References are contactable referees (consent-bearing) and stay
  // internal; JSON Resume references are quotes, i.e. our recommendations.
  const references = sortBy('recommendations', filtered.recommendations).map((rec) => compact({
    name: rec.recommender_name,
    reference: plain(rec.text, locale),
  }))

  const sections: Array<[string, Json[]]> = [
    ['work', work], ['volunteer', volunteer], ['education', education],
    ['awards', awards], ['certificates', certificates], ['publications', publications],
    ['skills', skills], ['languages', languages], ['projects', projects],
    ['references', references],
  ]
  for (const [key, items] of sections) {
    const kept = items.filter((item) => Object.keys(item).length)
    if (kept.length) doc[key] = kept
  }
  return doc
}
