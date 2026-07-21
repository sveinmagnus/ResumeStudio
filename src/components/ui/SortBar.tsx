import { useState } from 'react'
import { ArrowDownUp, ListPlus, Filter } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { availableSortModes, SORT_LABELS, type SortMode } from '../../lib/sectionSort'
import { bulkSpec } from '../../lib/bulkImport'
import { BulkImportModal } from './BulkImportModal'
import { SummarizeAllButton } from './SummarizeAllButton'
import { summaryFields } from '../../lib/summarizeBatch'
import { typeGroups, typeFilterKey, type SelectableItem } from '../../lib/viewItemSelect'
import type { SectionKey } from '../../types'

type ArraySection = SectionKey

/**
 * The bar above a section's item list: sort selector left, bulk-add right.
 *
 * Sort switches the editor's display order between Custom (the persisted
 * sort_order) and the computed modes (alphabetical / dates). Selecting a mode
 * never mutates data; only a manual reorder does (see useReorderGuard /
 * store.moveItem).
 *
 * The two halves appear independently: sorting needs two items to be
 * meaningful, but bulk-adding is MOST useful on an empty section, so the bar
 * renders whenever either half applies. Bulk is offered per `bulkImport`'s spec
 * table (content sections only — not Languages, not the registries).
 */
export function SortBar({ section, count }: { section: ArraySection; count: number }) {
  const mode = useStore((s) => s.sectionSort[section] ?? 'custom')
  const setSectionSort = useStore((s) => s.setSectionSort)
  // Editor type filter (UI-only, never touches views/exports).
  const items = useStore((s) => s.data[section]) as unknown as SelectableItem[]
  const locale = useStore((s) => s.primaryLocale)
  const roles = useStore((s) => s.data.roles)
  const keyQualifications = useStore((s) => s.data.key_qualifications)
  const filterKey = useStore((s) => s.sectionTypeFilter[section] ?? '')
  const setSectionTypeFilter = useStore((s) => s.setSectionTypeFilter)
  const [bulkOpen, setBulkOpen] = useState(false)

  const modes = availableSortModes(section)
  const showSort = count >= 2 && modes.length >= 2
  const spec = bulkSpec(section)

  // Facet groups for the type filter (only those with actual values). Built off
  // the UNFILTERED items so options don't vanish once a filter is applied.
  const facetSets = (count >= 2 ? typeGroups(section, items, locale, { roles, keyQualifications }) : [])
    .filter((s) => s.groups.length > 0)
  const showFilter = facetSets.length > 0

  if (!showSort && !showFilter && !spec && !summaryFields(section)) return null

  return (
    <div className="sortbar">
      {showSort && (
        <>
          <ArrowDownUp size={13} className="sortbar-icon" />
          <label className="sortbar-label" htmlFor={`sort-${section}`}>Sort</label>
          <select
            id={`sort-${section}`}
            className="sortbar-select"
            value={mode}
            onChange={(e) => setSectionSort(section, e.target.value as SortMode)}
          >
            {modes.map((m) => (
              <option key={m} value={m}>{SORT_LABELS[m]}</option>
            ))}
          </select>
          {mode !== 'custom' && (
            <span className="sortbar-hint">Reordering switches back to Custom</span>
          )}
        </>
      )}
      {showFilter && (
        <>
          <Filter size={13} className="sortbar-icon" />
          <label className="sortbar-label" htmlFor={`filter-${section}`}>Filter</label>
          <select
            id={`filter-${section}`}
            className={`sortbar-select${filterKey ? ' sortbar-select-active' : ''}`}
            value={filterKey}
            onChange={(e) => setSectionTypeFilter(section, e.target.value)}
            title="Show only items of one type (editor view only — never affects exports)"
          >
            <option value="">All types</option>
            {facetSets.map((set) => (
              <optgroup key={set.name} label={set.name}>
                {set.groups.map((g) => (
                  <option key={g.value || '_untyped'} value={typeFilterKey(set.name, g.value)}>
                    {g.label} ({g.ids.length})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </>
      )}
      {/* Right-hand group. Bulk add is anchored last so the summarize button —
          which comes and goes with the empty count — never shifts it. */}
      <div className="sortbar-actions">
        <SummarizeAllButton section={section} />
        {spec && (
          <button
            className="sortbar-bulk"
            onClick={() => setBulkOpen(true)}
            title={`Add many ${spec.label.toLowerCase()} at once, with help from your own AI`}
          >
            <ListPlus size={13} /> Bulk add
          </button>
        )}
      </div>
      {bulkOpen && spec && <BulkImportModal spec={spec} onClose={() => setBulkOpen(false)} />}
      <style>{`
        .sortbar {
          display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
          padding: 7px 11px; background: var(--paper-raised);
          border: 1px solid var(--line); border-radius: var(--r-md);
          flex-wrap: wrap; /* a summarize error must not blow the bar out */
        }
        .sortbar-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .sortbar-icon { color: var(--ink-faint); flex-shrink: 0; }
        .sortbar-label {
          font-size: 11px; font-weight: 600; letter-spacing: .06em;
          text-transform: uppercase; color: var(--ink-faint);
        }
        .sortbar-select {
          padding: 5px 9px; border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper); font-size: 13px; font-weight: 500; cursor: pointer;
        }
        .sortbar-select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash); }
        .sortbar-select-active { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); }
        .sortbar-hint { font-size: 11.5px; color: var(--ink-faint); font-style: italic; }
        .sortbar-bulk {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 10px; border-radius: var(--r-sm);
          border: 1px solid var(--line-strong); background: var(--paper);
          font-size: 12px; font-weight: 600; color: var(--ink-soft);
          transition: color .13s, background .13s, border-color .13s;
        }
        .sortbar-bulk:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-wash); }
      `}</style>
    </div>
  )
}
