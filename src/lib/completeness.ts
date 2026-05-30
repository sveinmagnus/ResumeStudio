/**
 * Translation completeness — what percentage of translatable fields have
 * content in each supported locale.
 *
 * Pure function. Lives here (not in the component) so it can be tested and
 * so other consumers (e.g. an export warning, a CI check) can call it.
 */

import type { ResumeStore, LocalizedString } from '../types'
import { getItemTitle } from './viewFilter'

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
      if (v && v.trim()) present++
      else missing.push(f.meta)
    }
    result[l] = {
      percent: Math.round((present / fields.length) * 100),
      missing,
    }
  }
  return result
}
