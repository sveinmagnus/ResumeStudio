import { useRef } from 'react'
import { useStore } from './useStore'
import type { ResumeStore, SectionKey } from '../types'

type ArraySection = SectionKey
type ItemOf<K extends ArraySection> = ResumeStore[K] extends Array<infer T> ? T : never

/**
 * Keep the currently-EXPANDED item stable in a section's displayed list while
 * the user works on it, so a per-keystroke autosave can't yank it away:
 *
 *  - it stays PRESENT even if a live filter (e.g. the registry
 *    "missing translation" filter) would now exclude it — so finishing a
 *    translation doesn't unmount the edit box mid-typing;
 *  - it stays at the POSITION it had when it was opened even if a date/name
 *    edit would re-sort it — so the card doesn't jump out from under the caret.
 *
 * Everything else in the list keeps sorting/filtering freshly around it. When
 * the user leaves the item (collapses it or opens another), the freeze releases
 * and the list settles to its natural order/membership. Reorders are therefore
 * only "committed" once the user is done with the item — matching the reported
 * expectation that editing a field shouldn't reorder the list under you.
 *
 * `fresh` is the already sorted+filtered list the editor would otherwise
 * render; `section` is used to pull the raw (unfiltered) item back in when the
 * filter has dropped it.
 */
export function useStableExpanded<K extends ArraySection>(section: K, fresh: ItemOf<K>[]): ItemOf<K>[] {
  const expandedId = useStore((s) => s.expandedItemId)
  const raw = useStore((s) => s.data[section]) as unknown as Array<{ id: string }>
  // Remembers where the expanded item sat when it was opened, so subsequent
  // re-sorts don't move it. Reset whenever the expanded item changes/clears.
  const home = useRef<{ id: string; index: number } | null>(null)

  const rawItem = expandedId ? raw.find((i) => i.id === expandedId) : undefined
  if (!expandedId || !rawItem) {
    home.current = null
    return fresh
  }

  const inFresh = fresh.findIndex((i) => (i as { id: string }).id === expandedId)
  if (home.current?.id !== expandedId) {
    // First render since this item was expanded: pin its current index (or the
    // end, if a filter already excludes it — unusual, but keeps it present).
    home.current = { id: expandedId, index: inFresh >= 0 ? inFresh : fresh.length }
  }

  // Already present at its pinned index → nothing to do.
  if (inFresh === home.current.index) return fresh

  const without = fresh.filter((i) => (i as { id: string }).id !== expandedId)
  const idx = Math.max(0, Math.min(home.current.index, without.length))
  return [...without.slice(0, idx), rawItem as ItemOf<K>, ...without.slice(idx)]
}
