import type { Publication } from '../types'

export type PublicationType = Publication['publication_type']

/**
 * Ordered publication types with their display labels — the SINGLE source for
 * both the editor dropdown and the rendered "(Type)" parenthetical, so the two
 * can never drift. "Thesis" covers a bachelor's / master's thesis or a
 * master-level major project report; "Research Publication" covers
 * peer-reviewed / academic research output.
 */
export const PUBLICATION_TYPES: ReadonlyArray<{ value: PublicationType; label: string }> = [
  { value: 'article', label: 'Article' },
  { value: 'research', label: 'Research Publication' },
  { value: 'whitepaper', label: 'Whitepaper' },
  { value: 'report', label: 'Report' },
  { value: 'thesis', label: 'Thesis' },
  { value: 'book', label: 'Book' },
  { value: 'book_chapter', label: 'Book chapter' },
  { value: 'blog_post', label: 'Blog post' },
]

const LABELS: Record<string, string> = Object.fromEntries(
  PUBLICATION_TYPES.map((t) => [t.value, t.label]),
)

/** Human label for a stored publication_type; '' for unknown/absent. */
export function publicationTypeLabel(type: string | null | undefined): string {
  return (type != null && LABELS[type]) || ''
}
