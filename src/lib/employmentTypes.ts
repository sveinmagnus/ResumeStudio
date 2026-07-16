/**
 * PURE: the employment-type vocabulary — the SINGLE source for the Employment
 * editor's dropdown, the card subtitle, and the view-editor's "Employment type"
 * facet, so they can't drift.
 *
 * English-only, unlike positionTypes / publicationTypes: `employment_type` is
 * NOT rendered in exports (it's editor metadata used for sorting/filtering), so
 * it stays on the editor side of the export/editor boundary — see
 * lib/exportStrings.ts on why editor chrome isn't localized.
 */

export const EMPLOYMENT_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'contract', label: 'Contract' },
  { value: 'freelance', label: 'Freelance' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'internship', label: 'Internship' },
]

const LABELS: Record<string, string> = Object.fromEntries(
  EMPLOYMENT_TYPES.map((t) => [t.value, t.label]),
)

/** Human label for a stored employment_type; '' for none/unknown. */
export function employmentTypeLabel(type: string | null | undefined): string {
  return (type != null && LABELS[type]) || ''
}
