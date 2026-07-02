/**
 * Translation completeness — what percentage of translatable fields have
 * content in each supported locale.
 *
 * Pure function. Lives here (not in the component) so it can be tested and
 * so other consumers (e.g. an export warning, a CI check) can call it.
 */

import type { ResumeStore, LocalizedString } from '../types'
import { getItemTitle } from './viewFilter'
import { richToPlain } from './richText'
import { resolve } from './locales'
import { SECTIONS } from './sections'

/**
 * Identifies a single tracked field that is empty in the requested locale.
 * The labels are pre-resolved so the consumer (Overview drill-down) can
 * render them without knowing anything about the data model, and the
 * (section, itemId) pair is enough to navigate the editor to the item.
 *
 * `itemId` is null for fields on the root Resume (which lives in the
 * `header` section and has no per-item navigation target).
 */
export interface MissingField {
  section: string       // SectionKey, or 'header' for root resume fields
  itemId: string | null
  itemLabel: string
  fieldLabel: string
}

export interface LocaleCompleteness {
  percent: number       // 0–100
  missing: MissingField[]
}

interface TrackedField {
  ls: LocalizedString
  meta: MissingField
}

/**
 * Identification label for an item is resolved with `en` as the requested
 * locale; `resolve()` falls back to any non-empty value if `en` is empty.
 * That means an item with content in any locale still gets a meaningful
 * label even when checking a different language.
 */
const LABEL_LOCALE = 'en'

/**
 * For each requested locale, return:
 *   - `percent`: the integer percentage (0–100) of tracked LocalizedString
 *     fields that have a non-empty value in that locale, and
 *   - `missing`: the list of fields without content in that locale.
 *
 * Tracked fields are the user-visible "primary" content fields — not every
 * single LocalizedString in the data. The set is intentionally curated so a
 * locale appearing 100% means the resume reads well in that language.
 *
 * Returns 100 / `[]` for any locale when there are no tracked fields at all
 * (a fresh resume is trivially "complete").
 */
export function computeCompleteness(
  data: ResumeStore,
  locales: string[],
): Record<string, LocaleCompleteness> {
  const fields: TrackedField[] = []

  const track = (
    ls: LocalizedString | undefined,
    section: string,
    itemId: string | null,
    itemLabel: string,
    fieldLabel: string,
  ) => {
    if (ls && Object.keys(ls).length) {
      fields.push({ ls, meta: { section, itemId, itemLabel, fieldLabel } })
    }
  }

  if (data.resume) {
    const root = 'Personal details'
    track(data.resume.title,              'header', null, root, 'Title')
    track(data.resume.nationality,        'header', null, root, 'Nationality')
    track(data.resume.place_of_residence, 'header', null, root, 'Place of residence')
  }
  data.key_qualifications.forEach((k) => {
    const label = getItemTitle('key_qualifications', k, LABEL_LOCALE)
    track(k.summary,  'key_qualifications', k.id, label, 'Summary')
    track(k.tag_line, 'key_qualifications', k.id, label, 'Tagline')
  })
  data.projects.forEach((p) => {
    const label = getItemTitle('projects', p, LABEL_LOCALE)
    track(p.customer,         'projects', p.id, label, 'Customer')
    track(p.description,      'projects', p.id, label, 'Description')
    track(p.long_description, 'projects', p.id, label, 'Long description')
  })
  data.work_experiences.forEach((w) => {
    const label = getItemTitle('work_experiences', w, LABEL_LOCALE)
    track(w.employer,         'work_experiences', w.id, label, 'Employer')
    track(w.long_description, 'work_experiences', w.id, label, 'Long description')
  })
  data.educations.forEach((e) => {
    const label = getItemTitle('educations', e, LABEL_LOCALE)
    track(e.school, 'educations', e.id, label, 'School')
    track(e.degree, 'educations', e.id, label, 'Degree')
  })
  data.courses.forEach((c) => {
    const label = getItemTitle('courses', c, LABEL_LOCALE)
    track(c.name, 'courses', c.id, label, 'Name')
  })
  data.certifications.forEach((c) => {
    const label = getItemTitle('certifications', c, LABEL_LOCALE)
    track(c.name, 'certifications', c.id, label, 'Name')
  })

  // Registry names (skills / roles / industries) that are ACTIVELY USED
  // elsewhere in the resume. An unused registry entry never reaches an export,
  // so leaving it untranslated shouldn't drag the score down — but a skill that
  // appears on a project and lacks a translation absolutely should. (Fixes the
  // "100 untranslated skills but 100% complete" report.) Membership sets are
  // built in one pass so this stays cheap for large registries.
  const usedSkillIds = new Set<string>()
  const usedRoleIds = new Set<string>()
  const usedIndustryIds = new Set<string>()
  for (const p of data.projects) {
    for (const ps of p.skills) usedSkillIds.add(ps.skill_id)
    for (const pr of p.roles) usedRoleIds.add(pr.role_id)
    for (const pi of p.industries) usedIndustryIds.add(pi.industry_id)
  }
  for (const c of data.technology_categories) for (const cs of c.skills) usedSkillIds.add(cs.skill_id)
  for (const w of data.work_experiences) if (w.role_id) usedRoleIds.add(w.role_id)

  data.skills.forEach((s) => {
    if (!usedSkillIds.has(s.id)) return
    track(s.name, 'skills', s.id, resolve(s.name, LABEL_LOCALE) || 'Skill', 'Skill name')
  })
  data.roles.forEach((r) => {
    if (r.disabled || !usedRoleIds.has(r.id)) return
    track(r.name, 'roles', r.id, resolve(r.name, LABEL_LOCALE) || 'Role', 'Role name')
  })
  data.industries.forEach((i) => {
    if (i.disabled || !usedIndustryIds.has(i.id)) return
    track(i.name, 'industries', i.id, resolve(i.name, LABEL_LOCALE) || 'Industry', 'Industry name')
  })

  const result: Record<string, LocaleCompleteness> = {}
  for (const l of locales) {
    if (fields.length === 0) {
      result[l] = { percent: 100, missing: [] }
      continue
    }
    const missing: MissingField[] = []
    let present = 0
    for (const f of fields) {
      const v = f.ls[l]
      // Strip rich-text markup so a value like `<p></p>` counts as empty.
      // Plain text is unchanged (fast path).
      if (v && richToPlain(v).trim()) present++
      else missing.push(f.meta)
    }
    result[l] = {
      percent: Math.round((present / fields.length) * 100),
      missing,
    }
  }
  return result
}

// ─── Per-section coverage ────────────────────────────────────────────────────

export interface SectionCoverage {
  /** Section key matching SectionDef.key (e.g. "projects", "educations"). */
  key: string
  /** Human-friendly label sourced from SECTIONS. */
  label: string
  /** Total items in the section (after disabled filter — disabled items don't count). */
  total: number
  /**
   * Items with at least one populated tracked field in the requested locale.
   * 0 means the section is *entirely* missing in that language.
   */
  populated: number
}

/**
 * Return per-section coverage in a given locale for sections that hold
 * localised content.
 *
 * Used by the Overview's "Show sections missing language content" affordance.
 * The intent is to surface the **structural** picture — does this language
 * even cover this section? — not the same data the field-level drill-down
 * already shows. Sections are sorted so the *most-broken* (highest
 * missing-count) appear first; sections that are completely empty (total=0)
 * sink to the bottom since "missing in language X" doesn't apply.
 */
export function computeSectionCoverage(
  data: ResumeStore,
  locale: string,
): SectionCoverage[] {
  const out: SectionCoverage[] = []
  for (const def of SECTIONS) {
    if (!def.storeKey) continue
    // Synthetic view-only sections (promoted_projects) reuse another section's
    // storeKey — measuring them would double-count. Skip.
    if (def.virtual) continue
    // Registries (Skill, Role) and the export views section have content
    // worth measuring too, but the consultant doesn't think of them as
    // "language content" — skip to match the user mental model.
    if (def.storeKey === 'skills' || def.storeKey === 'roles' || def.storeKey === 'views') continue

    const rawItems = data[def.storeKey] as unknown[]
    const items = rawItems.filter(
      (it) => !(it as { disabled?: boolean }).disabled,
    )

    let populated = 0
    for (const item of items) {
      if (itemHasContentInLocale(def.storeKey, item as Record<string, unknown>, locale)) populated++
    }
    out.push({ key: def.key, label: def.label, total: items.length, populated })
  }
  // Most-missing first; empty sections last.
  return out.sort((a, b) => {
    const ga = a.total - a.populated
    const gb = b.total - b.populated
    // Sections with no items at all aren't actionable — push to the bottom.
    if (a.total === 0 && b.total !== 0) return 1
    if (b.total === 0 && a.total !== 0) return -1
    if (gb !== ga) return gb - ga
    return a.label.localeCompare(b.label)
  })
}

/**
 * Per-section probe: does this item have any user-facing localized content
 * in the requested locale? Mirrors the "primary content fields" used by
 * computeCompleteness — same idea, per item instead of in aggregate.
 *
 * The check is "any one of the section's key fields has non-empty content"
 * — a permissive bar, since we're answering "is there *anything* here in
 * this language" rather than "is this item fully translated".
 */
function itemHasContentInLocale(
  storeKey: string,
  item: Record<string, unknown>,
  locale: string,
): boolean {
  const has = (field: string): boolean => {
    const ls = item[field] as LocalizedString | undefined
    const v = ls?.[locale]
    return !!(v && richToPlain(v).trim())
  }
  switch (storeKey) {
    case 'key_qualifications':    return has('summary') || has('tag_line') || has('label')
    case 'key_competencies':      return has('title') || has('description')
    case 'recommendations':       return has('text') || has('relationship')
    case 'projects':              return has('customer') || has('description') || has('long_description')
    case 'work_experiences':      return has('employer') || has('role_title') || has('long_description')
    case 'educations':            return has('school') || has('degree') || has('description')
    case 'courses':               return has('name') || has('program') || has('description')
    case 'certifications':        return has('name') || has('organiser') || has('description')
    case 'spoken_languages':      return has('name') || has('level')
    case 'technology_categories': return has('name')
    case 'positions':             return has('name') || has('organisation') || has('description')
    case 'presentations':         return has('title') || has('event') || has('description')
    case 'publications':          return has('title') || has('publisher') || has('abstract')
    case 'honor_awards':          return has('name') || has('issuer') || has('description')
    case 'references':            return has('relationship')
    default:                      return false
  }
}
