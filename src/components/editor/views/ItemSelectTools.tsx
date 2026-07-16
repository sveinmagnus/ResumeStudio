/**
 * Bulk item selection for one section of a Resume View: All / None, plus a
 * tri-state chip per type for sections that classify their items
 * (Other roles, Publications — see lib/viewItemSelect.ts).
 *
 * All the set maths lives in the lib; this file only renders it and reports the
 * next exclusion list. Kept out of ViewEditor.tsx purely for that file's size.
 */

import { useId } from 'react'
import {
  groupState, includeIds, excludeIds, toggleIds, typeGroups,
  type SelectableItem,
} from '../../../lib/viewItemSelect'

interface Props {
  sectionKey: string
  /** The items this section actually lists, already sorted/filtered. */
  items: readonly SelectableItem[]
  /** The view's FULL exclusion list (global across sections). */
  excludedIds: string[]
  /** Editing locale — type labels follow the item list's language. */
  locale: string
  /** Section name, for accessible labels. */
  sectionLabel: string
  onChange: (nextExcluded: string[]) => void
}

export function ItemSelectTools({
  sectionKey, items, excludedIds, locale, sectionLabel, onChange,
}: Props) {
  const labelId = useId()
  const ids = items.map((it) => it.id)
  const state = groupState(excludedIds, ids)
  const groups = typeGroups(sectionKey, items, locale)

  // One item needs no bulk control, and a facet with a single group is just a
  // second "All" button — don't spend a row on either.
  const showFacets = groups.length > 1
  if (ids.length < 2) return null

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

      {showFacets && (
        <div className="rv-item-facets">
          {groups.map((g) => {
            const gs = groupState(excludedIds, g.ids)
            const included = g.ids.length - g.ids.filter((id) => excludedIds.includes(id)).length
            return (
              <label key={g.value || '_untyped'} className="rv-item-facet">
                <input
                  type="checkbox"
                  checked={gs === 'all'}
                  // A partially-selected type is neither on nor off; the DOM
                  // only exposes that as a property, not an attribute.
                  ref={(el) => { if (el) el.indeterminate = gs === 'some' }}
                  onChange={() => onChange(toggleIds(excludedIds, g.ids))}
                  // Named explicitly rather than by the wrapping label: that
                  // would concatenate the two spans into "Board member2/2",
                  // since the space between them is CSS gap, not text. Keeps
                  // the visible label as a prefix (WCAG 2.5.3).
                  aria-label={`${g.label} — ${included} of ${g.ids.length} selected`}
                />
                <span className="rv-item-facet-name">{g.label}</span>
                <span className="rv-item-facet-count">{included}/{g.ids.length}</span>
              </label>
            )
          })}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {`${ids.length - excludedIds.filter((id) => ids.includes(id)).length} of ${ids.length} ${sectionLabel} items included`}
      </span>
    </div>
  )
}
