/**
 * Bulk item selection for one section of a Resume View: All / None inline, plus
 * a "By type" dropdown of tri-state facet chips for sections that classify
 * their items (position/publication type, employment type, and the ROLES a
 * project or employment carries — see lib/viewItemSelect.ts).
 *
 * The facets live in a popover rather than an inline row because a role facet
 * can list many values; All/None stay inline as the common action. All the set
 * maths lives in the lib — this file renders it and reports the next exclusion
 * list. Kept out of ViewEditor.tsx purely for that file's size.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  groupState, includeIds, excludeIds, toggleIds, typeGroups, isSingleSelectSection,
  type SelectableItem, type FacetGroupSet,
} from '../../../lib/viewItemSelect'
import type { Role, KeyQualification } from '../../../types'

interface Props {
  sectionKey: string
  /** The items this section actually lists, already sorted/filtered. */
  items: readonly SelectableItem[]
  /** The view's FULL exclusion list (global across sections). */
  excludedIds: string[]
  /** Editing locale — type labels follow the item list's language. */
  locale: string
  /** Role registry, so a role facet can name its values. */
  roles: readonly Role[]
  /** Profiles, so the key-competency "Profile" facet can name its values. */
  keyQualifications?: readonly KeyQualification[]
  /** Section name, for accessible labels. */
  sectionLabel: string
  onChange: (nextExcluded: string[]) => void
}

/** Count of `ids` currently included (not excluded). */
function includedCount(excludedIds: readonly string[], ids: readonly string[]): number {
  const ex = new Set(excludedIds)
  return ids.reduce((n, id) => (ex.has(id) ? n : n + 1), 0)
}

export function ItemSelectTools({
  sectionKey, items, excludedIds, locale, roles, keyQualifications, sectionLabel, onChange,
}: Props) {
  const labelId = useId()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const ids = items.map((it) => it.id)
  // Radio single-select sections (Profile) have no "select many" semantics —
  // the item list itself is the control, so no bulk tools apply.
  if (isSingleSelectSection(sectionKey) || ids.length < 2) return null

  const state = groupState(excludedIds, ids)
  const facetSets: FacetGroupSet[] = typeGroups(sectionKey, items, locale, { roles, keyQualifications })
  // A facet with a single group is just a second "All" — not worth a dropdown.
  const usefulSets = facetSets.filter((s) => s.groups.length > 1)
  const hasFacets = usefulSets.length > 0

  // How many facet values are currently NOT fully included — a filter-in-effect
  // badge on the collapsed trigger so a partial selection is visible.
  const activeFacetValues = usefulSets.reduce((n, s) =>
    n + s.groups.filter((g) => groupState(excludedIds, g.ids) !== 'all').length, 0)

  const onPopKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); triggerRef.current?.focus() }
  }

  return (
    <div className="rv-item-tools" role="group" aria-labelledby={labelId}>
      <span className="rv-item-tools-label" id={labelId}>Select</span>
      <button
        type="button"
        className="rv-item-tool-btn"
        disabled={state === 'all'}
        onClick={() => onChange(includeIds(excludedIds, ids))}
      >
        All
      </button>
      <button
        type="button"
        className="rv-item-tool-btn"
        disabled={state === 'none'}
        onClick={() => onChange(excludeIds(excludedIds, ids))}
      >
        None
      </button>

      {hasFacets && (
        <div className="rv-item-facet-wrap" ref={wrapRef} onKeyDown={onPopKeyDown}>
          <button
            ref={triggerRef}
            type="button"
            className={`rv-item-tool-btn rv-item-facet-trigger ${activeFacetValues ? 'is-filtered' : ''}`}
            aria-expanded={open}
            aria-haspopup="true"
            onClick={() => setOpen((o) => !o)}
          >
            By type
            {activeFacetValues > 0 && <span className="rv-item-facet-badge">{activeFacetValues}</span>}
            <ChevronDown size={13} className={open ? 'rv-chev-open' : ''} />
          </button>

          {open && (
            <div className="rv-item-facet-pop" role="group" aria-label={`Filter ${sectionLabel} by type`}>
              {usefulSets.map((set) => (
                <div key={set.name} className="rv-item-facet-group">
                  <div className="rv-item-facet-group-head">{set.name}</div>
                  {set.groups.map((g) => {
                    const gs = groupState(excludedIds, g.ids)
                    const included = includedCount(excludedIds, g.ids)
                    return (
                      <label key={g.value || '_untyped'} className="rv-item-facet">
                        <input
                          type="checkbox"
                          checked={gs === 'all'}
                          // A partly-selected group is neither on nor off; the
                          // DOM exposes that only as a property, not attribute.
                          ref={(el) => { if (el) el.indeterminate = gs === 'some' }}
                          onChange={() => onChange(toggleIds(excludedIds, g.ids))}
                          // Named explicitly, not by the label: the visible
                          // "2/2" is a separate span, so the label would
                          // announce "Board member2/2" (WCAG 2.5.3).
                          aria-label={`${g.label} — ${included} of ${g.ids.length} selected`}
                        />
                        <span className="rv-item-facet-name">{g.label}</span>
                        <span className="rv-item-facet-count">{included}/{g.ids.length}</span>
                      </label>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {`${includedCount(excludedIds, ids)} of ${ids.length} ${sectionLabel} items included`}
      </span>
    </div>
  )
}
