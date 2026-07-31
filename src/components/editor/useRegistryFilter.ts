/**
 * The filter/counts scaffolding every registry editor (Skills, Roles,
 * Industries) needs.
 *
 * All three repeated the same five blocks verbatim: a usage-count map, the
 * all/unused/missing counts, the filtered list, the stable-expanded wrapper,
 * and the frozen "missing translation" batch rows. Only the section name and
 * the reference-counting function differ.
 */
import { useMemo, useRef } from 'react'
import { useStore } from '../../store/useStore'
import { useStableExpanded } from '../../store/useStableExpanded'
import type { LocalizedString, ResumeStore } from '../../types'

/** The registry sections this hook serves. */
type RegistrySection = 'skills' | 'roles' | 'industries'

export type RegistryFilter = 'all' | 'unused' | 'missing-translation'

/** The minimum a registry entry must be for filtering/translation checks. */
export interface NamedItem { id: string; name: LocalizedString }

/**
 * "Missing translation" = the entry has content in the primary locale but not
 * in the active secondary. With no secondary set nothing is missing — the user
 * has explicitly hidden the second column, so there's no translation goal.
 */
export function isMissingTranslation(
  ls: LocalizedString,
  primary: string,
  secondary: string | null,
): boolean {
  if (!secondary) return false
  const p = (ls[primary] ?? '').trim()
  const s = (ls[secondary] ?? '').trim()
  return !!p && !s
}

/**
 * Freeze the rows shown in the batch "Missing translation" view. Once a row is
 * filled it's no longer missing, but yanking it out mid-keystroke would be
 * jarring — so while the filter is active we keep the ids captured on entry,
 * resolved to live data so the text updates and a ✓ appears. Switching filters
 * re-snapshots. The ref-during-render is intentional and idempotent.
 */
function useFrozenMissing<T extends NamedItem>(active: boolean, missing: T[], allItems: T[]): T[] {
  const frozen = useRef<string[] | null>(null)
  if (active) { if (!frozen.current) frozen.current = missing.map((i) => i.id) }
  else if (frozen.current) frozen.current = null
  const byId = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems])
  if (!active || !frozen.current) return missing
  const out: T[] = []
  for (const id of frozen.current) { const it = byId.get(id); if (it) out.push(it) }
  return out
}

export interface RegistryFilterResult<T> {
  /** Counts for the filter bar's three buttons. */
  counts: { all: number; unused: number; missing: number }
  /** `sortedItems` narrowed by the active filter. */
  items: T[]
  /** `items`, but keeping the currently-open card present past the filter. */
  displayItems: T[]
  /** Frozen rows for the batch-translation view. */
  batchRows: T[]
  /** Reference count per id, for "N projects" style meta lines. */
  usage: Map<string, number>
}

/**
 * @param section     store key, for `useStableExpanded`
 * @param sortedItems the registry's items in display order
 * @param countRefs   how many places reference an entry (drives 'unused')
 * @param filter      the active filter
 * @param extraFilter an additional narrowing applied AFTER the base filter and
 *   BEFORE the stable-expanded wrapper — Skills layers its category dropdown
 *   here. It deliberately does not affect `counts` or `batchRows`, which
 *   describe the whole registry.
 */
export function useRegistryFilter<T extends NamedItem>(
  section: RegistrySection,
  sortedItems: T[],
  countRefs: (data: ResumeStore, id: string) => number,
  filter: RegistryFilter,
  extraFilter?: (item: T) => boolean,
): RegistryFilterResult<T> {
  const data = useStore((s) => s.data)
  const primaryLocale = useStore((s) => s.primaryLocale)
  const secondaryLocale = useStore((s) => s.secondaryLocale)

  const usage = useMemo(
    () => new Map(sortedItems.map((i) => [i.id, countRefs(data, i.id)])),
    // countRefs is a module-level function per registry — stable by construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- countRefs is stable (see above)
    [sortedItems, data],
  )

  const missingItems = useMemo(
    () => sortedItems.filter((i) => isMissingTranslation(i.name, primaryLocale, secondaryLocale)),
    [sortedItems, primaryLocale, secondaryLocale],
  )

  const counts = useMemo(() => ({
    all: sortedItems.length,
    unused: sortedItems.filter((i) => (usage.get(i.id) ?? 0) === 0).length,
    missing: missingItems.length,
  }), [sortedItems, usage, missingItems])

  const items = useMemo(() => {
    const base = filter === 'unused'
      ? sortedItems.filter((i) => (usage.get(i.id) ?? 0) === 0)
      : filter === 'missing-translation'
        ? missingItems
        : sortedItems
    return extraFilter ? base.filter(extraFilter) : base
    // extraFilter is re-created per render by design (it closes over the
    // caller's own filter state, which is already a dependency below).
     
  }, [sortedItems, usage, missingItems, filter, extraFilter])

  // The hook is typed per store section; every registry item satisfies
  // NamedItem, and the identity of the returned rows is unchanged.
  const displayItems = useStableExpanded(section, items as never) as unknown as T[]
  const batchRows = useFrozenMissing(filter === 'missing-translation', missingItems, sortedItems)

  return { counts, items, displayItems, batchRows, usage }
}
