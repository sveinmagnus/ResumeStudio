/**
 * PURE: the key-oriented map of every localized TEXT field the advanced assists
 * may read from and write to, per section.
 *
 * Why this exists next to `completeness.ts → collectTrackedFields`, which walks
 * a similar set: that walker is LABEL-oriented (it produces "Long description"
 * for a human-readable completeness/drift report and deliberately skips
 * all-empty fields). The advisors need the opposite — the field KEY, so a model
 * can name a field in its reply and `applyProposals` can write to it, and every
 * field whether or not it currently has content. Deriving one from the other
 * would mean threading write-keys through a report type that has no use for
 * them, so they stay separate and a cross-check test pins them together.
 *
 * `identity` fields (customer, employer, school…) are included so the digest can
 * SHOW what an item is, but are marked non-prose: the writing passes only ever
 * propose edits to prose, because rewriting an employer's name is not a style
 * improvement, it's a factual error waiting to happen.
 */

import type { ResumeStore } from '../types'

export interface CvField {
  /** The property key on the item — what a proposal names and what we write to. */
  key: string
  /** Human label for the review UI. */
  label: string
  /**
   * Free-form writing, safe for a rewrite proposal. False for identity/name
   * fields, which the assists may read but must never rewrite.
   */
  prose: boolean
  /** A `LocalizedString[]` (a bullet list) rather than a single value. */
  list?: boolean
}

/**
 * Every section the advisors understand, with its text fields in display order.
 * A section absent from here is invisible to them — which is the right default
 * for the registries (names, not prose) and for Languages (CEFR levels).
 */
export const CV_FIELDS: Readonly<Record<string, readonly CvField[]>> = {
  key_qualifications: [
    { key: 'tag_line', label: 'Tag line', prose: false },
    { key: 'summary', label: 'Full profile', prose: true },
    { key: 'summary_short', label: 'Short summary', prose: true },
  ],
  key_competencies: [
    { key: 'title', label: 'Title', prose: false },
    { key: 'description', label: 'Description', prose: true },
    { key: 'short_description', label: 'Short description', prose: true },
  ],
  projects: [
    { key: 'customer', label: 'Customer', prose: false },
    { key: 'description', label: 'Project name', prose: false },
    { key: 'long_description', label: 'Description', prose: true },
    { key: 'short_description', label: 'Short description', prose: true },
    { key: 'highlights', label: 'Highlights', prose: true, list: true },
  ],
  work_experiences: [
    { key: 'employer', label: 'Employer', prose: false },
    { key: 'role_title', label: 'Role', prose: false },
    { key: 'long_description', label: 'Description', prose: true },
    { key: 'short_description', label: 'Short description', prose: true },
  ],
  positions: [
    { key: 'name', label: 'Position', prose: false },
    { key: 'organisation', label: 'Organisation', prose: false },
    { key: 'description', label: 'Description', prose: true },
    { key: 'short_description', label: 'Short description', prose: true },
  ],
  educations: [
    { key: 'school', label: 'School', prose: false },
    { key: 'degree', label: 'Degree', prose: false },
    { key: 'description', label: 'Description', prose: true },
    { key: 'short_description', label: 'Short description', prose: true },
  ],
  courses: [
    { key: 'name', label: 'Course', prose: false },
    { key: 'program', label: 'Programme', prose: false },
    { key: 'description', label: 'Description', prose: true },
    { key: 'short_description', label: 'Short description', prose: true },
  ],
  certifications: [
    { key: 'name', label: 'Certification', prose: false },
    { key: 'organiser', label: 'Issuer', prose: false },
    { key: 'description', label: 'Description', prose: true },
    { key: 'short_description', label: 'Short description', prose: true },
  ],
  presentations: [
    { key: 'title', label: 'Title', prose: false },
    { key: 'event', label: 'Event', prose: false },
    { key: 'description', label: 'Description', prose: true },
    { key: 'short_description', label: 'Short description', prose: true },
  ],
  publications: [
    { key: 'title', label: 'Title', prose: false },
    { key: 'publisher', label: 'Publisher', prose: false },
    { key: 'abstract', label: 'Abstract', prose: true },
    { key: 'short_description', label: 'Short description', prose: true },
  ],
  honor_awards: [
    { key: 'name', label: 'Award', prose: false },
    { key: 'issuer', label: 'Issuer', prose: false },
    { key: 'for_work', label: 'For', prose: false },
    { key: 'description', label: 'Description', prose: true },
    { key: 'short_description', label: 'Short description', prose: true },
  ],
  recommendations: [
    { key: 'recommender_title', label: 'Recommender', prose: false },
    { key: 'relationship', label: 'Relationship', prose: false },
    { key: 'text', label: 'Recommendation', prose: true },
    { key: 'short_description', label: 'Short description', prose: true },
  ],
}

/** The sections the advisors read, in a stable order. */
export const CV_SECTIONS: readonly string[] = Object.keys(CV_FIELDS)

/** Field descriptors for a section (empty for one the advisors don't cover). */
export function fieldsOf(section: string): readonly CvField[] {
  return CV_FIELDS[section] ?? []
}

/** One field descriptor by section + key, or null when unknown. */
export function fieldOf(section: string, key: string): CvField | null {
  return fieldsOf(section).find((f) => f.key === key) ?? null
}

/**
 * True when `section` names a store array the advisors cover. Guards every
 * model-supplied section name before it is used to index the store.
 */
export function isAdvisorSection(section: string, data: ResumeStore): boolean {
  return section in CV_FIELDS && Array.isArray((data as unknown as Record<string, unknown>)[section])
}

/** The (non-disabled) items of an advisor section. Never throws on a bad key. */
export function itemsOf(data: ResumeStore, section: string): Array<Record<string, unknown>> {
  if (!isAdvisorSection(section, data)) return []
  const raw = (data as unknown as Record<string, unknown>)[section]
  return (raw as Array<Record<string, unknown>>).filter((it) => it && it.disabled !== true)
}
