/**
 * PURE: the Course / Certification "category" vocabulary — the SINGLE source for
 * the Courses + Certifications editor dropdowns, the card subtitle, the editor
 * "type" filter, and the view-editor "By type" quick-select facet, so they can't
 * drift.
 *
 * English-only, like `lib/employmentTypes.ts` (NOT localized like
 * positionTypes / publicationTypes): a course/cert category is an EDITOR-ONLY
 * organizing tool — it is never rendered in an export — so it stays on the
 * editor side of the export/editor boundary (see lib/exportStrings.ts on why
 * editor chrome isn't localized, and CLAUDE.md §12).
 */

const RAW_COURSE_CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'technical_expertise', label: 'Technical expertise' },
  { value: 'non_technical_expertise', label: 'Non-technical expertise' },
  { value: 'entrepreneurship', label: 'Entrepreneurship' },
  { value: 'finance', label: 'Finance' },
  { value: 'management', label: 'Management' },
  { value: 'creativity_design', label: 'Creativity & Design' },
  { value: 'sales', label: 'Sales' },
  { value: 'soft_skills', label: 'Soft skills' },
  { value: 'communication', label: 'Communication' },
  { value: 'health_safety', label: 'Health & Safety' },
  { value: 'legal_compliance', label: 'Legal & Compliance' },
  { value: 'sustainability', label: 'Sustainability' },
  { value: 'quality', label: 'Quality' },
  { value: 'personal_development', label: 'Personal development' },
  { value: 'leisure', label: 'Leisure' },
  { value: 'vehicles', label: 'Vehicles' },
  { value: 'medical', label: 'Medical' },
]

/**
 * The vocabulary, sorted alphabetically by label — the ORDER every consumer
 * (editor dropdown, card subtitle, editor Filter, view "By type" facet) shows.
 * Sorting here (not per consumer) keeps them consistent and stays correct when
 * a new category is added to the raw list above. `value` is what's stored, so
 * reordering is display-only and safe.
 */
export const COURSE_CATEGORIES: ReadonlyArray<{ value: string; label: string }> =
  [...RAW_COURSE_CATEGORIES].sort((a, b) => a.label.localeCompare(b.label))

const LABELS: Record<string, string> = Object.fromEntries(
  COURSE_CATEGORIES.map((t) => [t.value, t.label]),
)

/** Human label for a stored course/cert category; '' for none/unknown. */
export function courseCategoryLabel(value: string | null | undefined): string {
  return (value != null && LABELS[value]) || ''
}
