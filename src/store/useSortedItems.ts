import { useStore } from './useStore'
import { useStableExpanded } from './useStableExpanded'
import { sortItems } from '../lib/sectionSort'
import type { ResumeStore, SectionKey } from '../types'

type ArraySection = SectionKey
type ItemOf<K extends ArraySection> = ResumeStore[K] extends Array<infer T> ? T : never

/**
 * Return a section's items ordered by its current display sort mode.
 *
 * Replaces the editors' previous inline `[...data.x].sort((a,b)=>a.sort_order-b.sort_order)`.
 * The returned array is fresh each render (sortItems copies), so it is safe to
 * map over and to derive the `ids` passed to SortableList.
 *
 * The currently-expanded item is pinned in place while it's open
 * (`useStableExpanded`) so a per-keystroke re-sort (e.g. editing a date in a
 * date-sorted section) can't move the card out from under the user.
 */
export function useSortedItems<K extends ArraySection>(section: K): ItemOf<K>[] {
  const items = useStore((s) => s.data[section]) as ItemOf<K>[]
  const mode = useStore((s) => s.sectionSort[section] ?? 'custom')
  const locale = useStore((s) => s.primaryLocale)
  const sorted = sortItems(
    section,
    items as unknown as Array<{ id: string; sort_order: number }>,
    mode,
    locale,
  ) as unknown as ItemOf<K>[]
  return useStableExpanded(section, sorted)
}
