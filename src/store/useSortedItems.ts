import { useStore } from './useStore'
import { sortItems } from '../lib/sectionSort'
import type { ResumeStore } from '../types'

type ArraySection = Exclude<keyof ResumeStore, 'resume'>
type ItemOf<K extends ArraySection> = ResumeStore[K] extends Array<infer T> ? T : never

/**
 * Return a section's items ordered by its current display sort mode.
 *
 * Replaces the editors' previous inline `[...data.x].sort((a,b)=>a.sort_order-b.sort_order)`.
 * The returned array is fresh each render (sortItems copies), so it is safe to
 * map over and to derive the `ids` passed to SortableList.
 */
export function useSortedItems<K extends ArraySection>(section: K): ItemOf<K>[] {
  const items = useStore((s) => s.data[section]) as ItemOf<K>[]
  const mode = useStore((s) => s.sectionSort[section] ?? 'custom')
  const locale = useStore((s) => s.primaryLocale)
  return sortItems(
    section,
    items as unknown as Array<{ id: string; sort_order: number }>,
    mode,
    locale,
  ) as unknown as ItemOf<K>[]
}
