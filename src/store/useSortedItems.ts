import { useStore } from './useStore'
import { useStableExpanded } from './useStableExpanded'
import { sortItems } from '../lib/sectionSort'
import { itemsMatchingTypeFilter, type SelectableItem } from '../lib/viewItemSelect'
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
  // Editor-only type filter (never affects views/exports). Needs the role +
  // profile registries to name/resolve facet values.
  const filterKey = useStore((s) => s.sectionTypeFilter[section] ?? '')
  const roles = useStore((s) => s.data.roles)
  const sorted = sortItems(
    section,
    items as unknown as Array<{ id: string; sort_order: number }>,
    mode,
    locale,
  ) as unknown as ItemOf<K>[]
  let filtered = sorted
  if (filterKey) {
    const match = itemsMatchingTypeFilter(
      section, sorted as unknown as SelectableItem[], locale, { roles }, filterKey,
    )
    if (match) filtered = sorted.filter((it) => match.has((it as unknown as { id: string }).id))
  }
  return useStableExpanded(section, filtered)
}
