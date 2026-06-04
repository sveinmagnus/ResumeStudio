import { ArrowDownUp } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { availableSortModes, SORT_LABELS, type SortMode } from '../../lib/sectionSort'
import type { ResumeStore } from '../../types'

type ArraySection = Exclude<keyof ResumeStore, 'resume'>

/**
 * Per-section sort selector shown above a section's item list. Switches the
 * editor's display order between Custom (the persisted sort_order) and the
 * computed modes (alphabetical / dates). Selecting a mode never mutates data;
 * only a manual reorder does (see useReorderGuard / store.moveItem).
 *
 * Renders nothing when the section has fewer than two items (nothing to sort)
 * or only supports Custom.
 */
export function SortBar({ section, count }: { section: ArraySection; count: number }) {
  const mode = useStore((s) => s.sectionSort[section] ?? 'custom')
  const setSectionSort = useStore((s) => s.setSectionSort)
  const modes = availableSortModes(section)

  if (count < 2 || modes.length < 2) return null

  return (
    <div className="sortbar">
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
        .sortbar-hint { font-size: 11.5px; color: var(--ink-faint); font-style: italic; margin-left: auto; }
      `}</style>
    </div>
  )
}
