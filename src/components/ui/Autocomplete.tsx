import { useState, useRef, useEffect, useMemo, KeyboardEvent } from 'react'
import { Plus } from 'lucide-react'

/**
 * One picker entry. `id` is the value passed back to `onPick`. `label` is the
 * primary text shown in the dropdown row and matched against the user's query.
 * `sublabel` is optional secondary text (e.g. customer name + project title).
 */
export interface AutocompleteOption {
  id: string
  label: string
  sublabel?: string
}

interface AutocompleteProps {
  options: AutocompleteOption[]
  /**
   * Called when the user picks an existing option (click / Enter on highlight).
   */
  onPick: (id: string) => void
  /**
   * Optional handler that creates a NEW entry from a free-text query. When
   * provided, an "Add" button appears whenever the typed text has no exact
   * label match. Enter on a query with no match calls this too.
   */
  onAddNew?: (text: string) => void
  /** Placeholder shown when the input is empty. */
  placeholder?: string
  /** What to call new things in the Add button label, e.g. "skill", "role". */
  addLabel?: string
  /** Maximum results shown in the dropdown (default 8). */
  maxResults?: number
  /** Reset the input back to empty after a successful pick / add (default true). */
  clearOnPick?: boolean
  /** Optional ARIA label. */
  ariaLabel?: string
  /** Optional starting query (rarely useful — mostly for tests). */
  initialQuery?: string
  /**
   * Async extra suggestions (e.g. the skill-taxonomy library) shown under the
   * registry matches. Picking one behaves like Add-new with that text, so it
   * requires `onAddNew`. Debounced; results that duplicate a registry option
   * label are dropped.
   */
  suggestExtra?: (query: string) => Promise<string[]>
  /** Row sublabel for extra suggestions (default 'Skill library'). */
  suggestLabel?: string
}

/**
 * Generic autocomplete typeahead. Search-as-you-type over a flat options list,
 * with an optional "Add new" affordance when no exact match exists.
 *
 * Keyboard:
 *   ↑/↓ — move highlight
 *   Enter — pick highlighted (or add-new when query has no exact match and
 *           onAddNew is provided)
 *   Esc — close dropdown
 *
 * Filtering is a case-insensitive substring match against `label` and `sublabel`,
 * with prefix matches ranked above mid-string matches. Cheap enough for the
 * registry sizes this app sees (tens to a couple hundred entries).
 */
export function Autocomplete({
  options,
  onPick,
  onAddNew,
  placeholder,
  addLabel = 'item',
  maxResults = 8,
  clearOnPick = true,
  ariaLabel,
  initialQuery = '',
  suggestExtra,
  suggestLabel = 'Skill library',
}: AutocompleteProps) {
  const [query, setQuery] = useState(initialQuery)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [extras, setExtras] = useState<string[]>([])
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounced async enrichment (taxonomy suggestions). A stale response is
  // ignored via the cancelled flag; suggestions clear with the query.
  useEffect(() => {
    if (!suggestExtra || !query.trim()) { setExtras([]); return }
    let cancelled = false
    const t = window.setTimeout(() => {
      void suggestExtra(query).then((names) => {
        if (!cancelled) setExtras(names)
      }).catch(() => { if (!cancelled) setExtras([]) })
    }, 150)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [query, suggestExtra])

  // Close on outside click. Mousedown (not click) so a chip-click outside
  // doesn't bubble through this listener after the input lost focus.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options.slice(0, maxResults)
    // Rank: exact label match first, then label prefix, then label substring,
    // then sublabel matches. Stable secondary sort by label A→Z.
    const scored = options
      .map((o) => {
        const lbl = o.label.toLowerCase()
        const sub = (o.sublabel ?? '').toLowerCase()
        if (lbl === q) return { o, score: 0 }
        if (lbl.startsWith(q)) return { o, score: 1 }
        if (lbl.includes(q)) return { o, score: 2 }
        if (sub.includes(q)) return { o, score: 3 }
        return { o, score: -1 }
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score || a.o.label.localeCompare(b.o.label))
    return scored.slice(0, maxResults).map((x) => x.o)
  }, [query, options, maxResults])

  const exactMatch = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return options.find((o) => o.label.toLowerCase() === q) ?? null
  }, [query, options])

  const canAddNew = !!onAddNew && query.trim().length > 0 && !exactMatch

  // Keep highlight in range as results shrink/grow.
  useEffect(() => {
    if (highlight >= results.length) setHighlight(Math.max(0, results.length - 1))
  }, [results.length, highlight])

  const pickResult = (id: string) => {
    onPick(id)
    if (clearOnPick) setQuery('')
    setOpen(false)
  }

  const addNewResult = () => {
    const text = query.trim()
    if (!text || !onAddNew) return
    onAddNew(text)
    if (clearOnPick) setQuery('')
    setOpen(false)
  }

  // Library suggestions never duplicate a visible registry row, and picking
  // one is the same as Add-new with that canonical text.
  const visibleExtras = (onAddNew && !exactMatch)
    ? extras.filter((name) => !results.some((r) => r.label.toLowerCase() === name.toLowerCase()))
    : []
  const pickExtra = (name: string) => {
    if (!onAddNew) return
    onAddNew(name)
    if (clearOnPick) setQuery('')
    setOpen(false)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight((h) => Math.min(results.length, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results.length > 0 && highlight < results.length) {
        pickResult(results[highlight].id)
      } else if (canAddNew) {
        addNewResult()
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={wrapRef} className="ac-wrap">
      <div className="ac-input-row">
        <input
          ref={inputRef}
          type="text"
          className="ac-input"
          value={query}
          placeholder={placeholder || `Search ${addLabel}…`}
          aria-label={ariaLabel || `Search ${addLabel}`}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
        {canAddNew && (
          <button
            type="button"
            className="ac-add-btn"
            onClick={addNewResult}
            title={`Create a new ${addLabel} named "${query.trim()}"`}
          >
            <Plus size={13} /> Add
          </button>
        )}
      </div>
      {open && (results.length > 0 || canAddNew || visibleExtras.length > 0) && (
        <div className="ac-pop" role="listbox">
          {results.map((o, i) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={i === highlight}
              className={`ac-row ${i === highlight ? 'is-hl' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => { e.preventDefault(); pickResult(o.id) }}
            >
              <span className="ac-row-label">{o.label}</span>
              {o.sublabel && <span className="ac-row-sub">{o.sublabel}</span>}
            </button>
          ))}
          {visibleExtras.map((name) => (
            <button
              key={`extra-${name}`}
              type="button"
              className="ac-row ac-row-extra"
              title={`Add "${name}" from the ${suggestLabel.toLowerCase()}`}
              onMouseDown={(e) => { e.preventDefault(); pickExtra(name) }}
            >
              <span className="ac-row-label">{name}</span>
              <span className="ac-row-sub">{suggestLabel}</span>
            </button>
          ))}
          {canAddNew && (
            <button
              type="button"
              className="ac-row ac-row-add"
              onMouseDown={(e) => { e.preventDefault(); addNewResult() }}
            >
              <Plus size={12} />
              <span>Add new {addLabel} <em>“{query.trim()}”</em></span>
            </button>
          )}
        </div>
      )}
      <style>{`
        .ac-wrap { position: relative; display: block; }
        .ac-input-row { display: flex; gap: 6px; align-items: stretch; }
        .ac-input {
          flex: 1; padding: 7px 10px; background: var(--paper-raised);
          border: 1px solid var(--line); border-radius: var(--r-sm);
          font-size: 13px;
        }
        .ac-input:focus {
          outline: none; border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-wash); background: #fff;
        }
        .ac-add-btn {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 6px 11px; font-size: 12.5px; font-weight: 600;
          color: var(--accent); border: 1px solid var(--accent);
          border-radius: var(--r-sm); background: var(--paper);
          cursor: pointer; transition: background .12s;
        }
        .ac-add-btn:hover { background: var(--accent-wash); }
        .ac-pop {
          position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 30;
          background: var(--paper-raised); border: 1px solid var(--line-strong);
          border-radius: var(--r-sm); box-shadow: var(--shadow-md);
          max-height: 260px; overflow-y: auto; padding: 4px;
        }
        .ac-row {
          display: flex; flex-direction: column; align-items: flex-start;
          width: 100%; text-align: left; padding: 6px 10px; border-radius: var(--r-sm);
          background: transparent; transition: background .08s; cursor: pointer;
        }
        .ac-row.is-hl, .ac-row:hover { background: var(--accent-wash); }
        .ac-row-label { font-size: 13px; font-weight: 500; color: var(--ink); }
        .ac-row-sub { font-size: 11.5px; color: var(--ink-faint); margin-top: 1px; }
        .ac-row-add {
          flex-direction: row; align-items: center; gap: 6px;
          border-top: 1px solid var(--line); margin-top: 2px; padding-top: 8px;
          color: var(--accent); font-weight: 600; font-size: 12.5px;
        }
        .ac-row-extra { border-top: 1px dashed var(--line); }
        .ac-row-extra .ac-row-sub { color: var(--secondary-ink-text, var(--ink-faint)); }
        .ac-row-add em { font-style: normal; font-weight: 500; }
      `}</style>
    </div>
  )
}
