import { useState, useMemo, useCallback, type KeyboardEvent } from 'react'
import { Search, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import { searchStore, type SearchHit } from '../lib/contentSearch'
import { canonicalSectionKey } from '../lib/sections'
import { useDialog } from './ui/useDialog'

/**
 * Global content search (roadmap F16) — a command-palette overlay that searches
 * every section, registry and the header for a substring and jumps to the
 * matching item. Opened from the header search button or Cmd/Ctrl+K.
 */
export function GlobalSearch({ onClose }: { onClose: () => void }) {
  const dialogRef = useDialog<HTMLDivElement>(onClose)
  const { data, primaryLocale, setActiveSection, setExpandedItem } = useStore()
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  const hits = useMemo(
    () => searchStore(data, query, primaryLocale),
    [data, query, primaryLocale],
  )

  const open = useCallback((hit: SearchHit) => {
    setActiveSection(canonicalSectionKey(hit.section))
    if (hit.id) setExpandedItem(hit.id)
    onClose()
  }, [setActiveSection, setExpandedItem, onClose])

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(hits.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)) }
    else if (e.key === 'Enter' && hits[highlight]) { e.preventDefault(); open(hits[highlight]) }
  }

  return (
    <div className="gs-overlay" role="dialog" aria-modal="true" aria-label="Search resume content" onClick={onClose}>
      <div className="gs-modal" ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <div className="gs-input-row">
          <Search size={17} className="gs-icon" />
          <input
            data-autofocus
            className="gs-input"
            type="text"
            value={query}
            placeholder="Search every section — projects, skills, employments, notes…"
            aria-label="Search query"
            onChange={(e) => { setQuery(e.target.value); setHighlight(0) }}
            onKeyDown={onKey}
          />
          <button className="gs-close" onClick={onClose} aria-label="Close search"><X size={16} /></button>
        </div>

        {query.trim().length >= 2 && (
          <div className="gs-results" role="listbox" aria-label="Search results">
            {hits.length === 0 ? (
              <div className="gs-empty">No matches for “{query.trim()}”.</div>
            ) : (
              hits.map((hit, i) => (
                <button
                  key={`${hit.section}-${hit.id}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  className={`gs-hit ${i === highlight ? 'is-hl' : ''}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => open(hit)}
                >
                  <div className="gs-hit-top">
                    <span className="gs-hit-title">{hit.title}</span>
                    <span className="gs-hit-section">{hit.sectionLabel}</span>
                  </div>
                  <div className="gs-hit-snippet">{hit.snippet}</div>
                </button>
              ))
            )}
          </div>
        )}
        {query.trim().length < 2 && (
          <div className="gs-hint">Type at least two characters. ↑↓ to move, Enter to open, Esc to close.</div>
        )}
      </div>

      <style>{`
        .gs-overlay {
          position: fixed; inset: 0; z-index: 70;
          background: rgba(15, 23, 42, .4);
          display: flex; justify-content: center; align-items: flex-start;
          padding: 12vh 20px 20px;
        }
        .gs-modal {
          width: 100%; max-width: 600px; background: var(--paper);
          border-radius: var(--r-lg); box-shadow: var(--shadow-lg);
          border: 1px solid var(--line); overflow: hidden;
          display: flex; flex-direction: column; max-height: 70vh;
        }
        .gs-input-row {
          display: flex; align-items: center; gap: 10px; padding: 14px 16px;
          border-bottom: 1px solid var(--line);
        }
        .gs-icon { color: var(--ink-faint); flex-shrink: 0; }
        .gs-input {
          flex: 1; border: none; outline: none; background: transparent;
          font-size: 15px; color: var(--ink);
        }
        .gs-close { color: var(--ink-faint); display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--r-sm); }
        .gs-close:hover { background: var(--paper-sunken); color: var(--ink); }
        .gs-results { overflow-y: auto; padding: 6px; }
        .gs-empty, .gs-hint { padding: 18px 16px; color: var(--ink-faint); font-size: 13px; }
        .gs-hit {
          display: block; width: 100%; text-align: left; padding: 9px 11px;
          border-radius: var(--r-sm); background: transparent; transition: background .08s;
        }
        .gs-hit.is-hl, .gs-hit:hover { background: var(--accent-wash); }
        .gs-hit-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
        .gs-hit-title { font-size: 13.5px; font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .gs-hit-section {
          font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em;
          color: var(--accent); background: var(--accent-wash); padding: 1px 7px; border-radius: 9px; flex-shrink: 0;
        }
        .gs-hit-snippet { font-size: 12px; color: var(--ink-soft); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      `}</style>
    </div>
  )
}
