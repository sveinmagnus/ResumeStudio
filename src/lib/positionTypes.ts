/**
 * Vocabulary for the "Other roles" (positions) type field — the SINGLE source
 * for the editor dropdown and the rendered label, so they can't drift. Lets a
 * consultant classify non-employment engagements (board seats, volunteering,
 * mentoring…) to sort and filter them. Optional per position.
 */
export const POSITION_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'board_member', label: 'Board member' },
  { value: 'committee_member', label: 'Committee member' },
  { value: 'advisor', label: 'Advisor' },
  { value: 'mentor', label: 'Mentor' },
  { value: 'coach', label: 'Coach' },
  { value: 'organizer', label: 'Organizer' },
  { value: 'volunteer', label: 'Volunteer' },
  { value: 'reviewer', label: 'Reviewer' },
]

const LABELS: Record<string, string> = Object.fromEntries(
  POSITION_TYPES.map((t) => [t.value, t.label]),
)

/** Human label for a stored position type; '' for none/unknown. */
export function positionTypeLabel(type: string | null | undefined): string {
  return (type != null && LABELS[type]) || ''
}
