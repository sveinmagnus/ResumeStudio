import { useState } from 'react'
import { ArrowDownUp, ListPlus } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { availableSortModes, SORT_LABELS, type SortMode } from '../../lib/sectionSort'
import { bulkSpec } from '../../lib/bulkImport'
import { BulkImportModal } from './BulkImportModal'
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
  const [bulkOpen, setBulkOpen] = useState(false)

  const modes = availableSortModes(section)
  const showSort = count >= 2 && modes.length >= 2
  const spec = bulkSpec(section)

  if (!showSort && !spec) return null

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
      {spec && (
        <button
          className="sortbar-bulk"
          onClick={() => setBulkOpen(true)}
          title={`Add many ${spec.label.toLowerCase()} at once, with help from your own AI`}
        >
          <ListPlus size={13} /> Bulk add
        </button>
      )}
      {bulkOpen && spec && <BulkImportModal spec={spec} onClose={() => setBulkOpen(false)} />}
      <style>{`
        .sortbar {
          display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
          padding: 7px 11px; background: var(--paper-raised);
          border: 1px solid var(--line); border-radius: var(--r-md);
        }
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
        .sortbar-hint { font-size: 11.5px; color: var(--ink-faint); font-style: italic; }
        /* Pinned right whether or not the sort half rendered. */
        .sortbar-bulk {
          margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
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
