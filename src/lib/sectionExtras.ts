/**
 * PURE: the optional per-section content groups a view can switch ON.
 *
 * Why this exists: the section catalog used to carry a different SET OF FACTS
 * per render target — the DOCX shape printed a project's team size, allocation
 * and highlights while the HTML preview and the ATS text export silently
 * dropped them. A consultant could not see in the preview what their PDF would
 * contain. Content is now identical across every adapter, and the facts that
 * used to appear only in DOCX are declared here instead: opt-in per view, so
 * "what goes in this export" is a decision the user makes once, in one place,
 * rather than an accident of which button they pressed.
 *
 * Every group defaults OFF. A view that enables nothing renders the core facts
 * only — the same in the preview, the PDF, the Word file and the ATS text.
 *
 * The labels here are EDITOR chrome (English-only, CLAUDE.md §12). The words
 * that land in an exported file live in lib/exportStrings.ts.
 */

import { lookup } from './lookup'

/** One switchable group of optional fields within a section. */
export interface ExtraGroup {
  /** Stored in `SectionStyle.extras`. Unique within its section only. */
  key: string
  /** Editor-facing name. */
  label: string
  /** Editor-facing one-liner naming the actual fields, so the checkbox says
   *  what it turns on without the user guessing. */
  hint: string
}

/**
 * Section key → its optional groups. A section absent here has no extras.
 * Adding a group is additive: absent from a saved view's `extras` = off.
 */
export const SECTION_EXTRAS: Record<string, ExtraGroup[]> = {
  projects: [
    { key: 'lead', label: 'Lead-in line', hint: 'Short description above the full description' },
    { key: 'metrics', label: 'Team & allocation', hint: 'Team size and percentage allocated' },
    { key: 'highlights', label: 'Highlights', hint: 'The project’s highlight bullets' },
    { key: 'links', label: 'Links', hint: 'External case-study URL' },
    { key: 'location', label: 'Location', hint: 'The project’s country' },
  ],
  work_experiences: [
    { key: 'employment_type', label: 'Employment type', hint: 'Permanent, contract, freelance…' },
    { key: 'company_size', label: 'Company size', hint: 'Local, national and global headcount' },
    { key: 'links', label: 'Links', hint: 'Company website' },
  ],
  educations: [
    { key: 'grade', label: 'Grade', hint: 'The grade or classification achieved' },
    { key: 'exchange', label: 'Study abroad', hint: 'Marks an exchange programme' },
  ],
  certifications: [
    { key: 'expiry', label: 'Expiry date', hint: 'When the certification lapses' },
    { key: 'links', label: 'Links', hint: 'Credential verification URL' },
  ],
  presentations: [
    { key: 'links', label: 'Links', hint: 'Talk or slides URL' },
  ],
  publications: [
    { key: 'links', label: 'Links', hint: 'Publication URL' },
  ],
  recommendations: [
    { key: 'links', label: 'Links', hint: 'Link to the recommendation' },
  ],
  honor_awards: [
    { key: 'for_work', label: 'Awarded for', hint: 'The work the award was given for' },
  ],
  references: [
    { key: 'contact', label: 'Contact details', hint: 'Relationship, email and phone' },
    { key: 'links', label: 'Links', hint: 'LinkedIn profile' },
  ],
}

/** The groups offered for a section (empty when it has none). */
export function extrasFor(sectionKey: string): ExtraGroup[] {
  return lookup(SECTION_EXTRAS, sectionKey, [])
}

/**
 * RENDER BOUNDARY: coerce a stored `extras` list to the keys this section
 * actually declares. A view arrives from an untrusted import (a backup file,
 * a synced folder, another machine's build), so an unknown or non-string entry
 * is dropped rather than trusted — the same discipline as `normalizeFullLayout`
 * and the header validators. Absent / malformed reads as "nothing enabled",
 * which is also the default.
 */
export function normalizeExtras(raw: unknown, sectionKey: string): ReadonlySet<string> {
  if (!Array.isArray(raw)) return EMPTY
  const allowed = new Set(extrasFor(sectionKey).map((g) => g.key))
  const out = new Set<string>()
  for (const v of raw) if (typeof v === 'string' && allowed.has(v)) out.add(v)
  return out.size ? out : EMPTY
}

const EMPTY: ReadonlySet<string> = new Set<string>()

/** Shared empty set, so a context with no extras allocates nothing. */
export const NO_EXTRAS = EMPTY
