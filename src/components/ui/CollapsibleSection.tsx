/**
 * A results list you can fold away, with the count still visible.
 *
 * Every advisor produces a list, and the Overview stacks five of them. Working
 * through the achievements while a twelve-item CV review sits open above them
 * means scrolling past the same twelve items every time — so each list folds
 * independently, and the header keeps the count so a collapsed section still
 * tells you there's work in it.
 *
 * Open by default: results have just arrived and burying them behind a click
 * would be the wrong trade. Collapsing is the exception, so it's the thing that
 * takes an action.
 *
 * Controlled or uncontrolled. Callers whose state outlives the component (the
 * store-backed advisors, whose results survive navigation) pass `open` +
 * `onToggle` so the fold survives too; everyone else lets it manage itself.
 */

import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

interface Props {
  /** Left-hand label, e.g. "Findings" or "Possible duplicates". */
  title: ReactNode
  /** Shown beside the title and while collapsed — the reason to open it again. */
  count?: number
  /** Extra controls for the header row (select-all, filters). Not part of the toggle. */
  actions?: ReactNode
  /** Controlled open state. Omit for self-managed. */
  open?: boolean
  onToggle?: (open: boolean) => void
  defaultOpen?: boolean
  children: ReactNode
}

export function CollapsibleSection({
  title, count, actions, open, onToggle, defaultOpen = true, children,
}: Props) {
  const [selfOpen, setSelfOpen] = useState(defaultOpen)
  const isOpen = open ?? selfOpen

  const toggle = () => {
    const next = !isOpen
    setSelfOpen(next)
    onToggle?.(next)
  }

  return (
    <div className="cs">
      <div className="cs-head">
        <button
          type="button"
          className="cs-toggle"
          onClick={toggle}
          aria-expanded={isOpen}
        >
          <ChevronDown size={14} className={isOpen ? 'cs-chev cs-open' : 'cs-chev'} />
          <span className="cs-title">{title}</span>
          {count !== undefined && <span className="cs-count">{count}</span>}
          {!isOpen && <span className="cs-hidden-note">hidden</span>}
        </button>
        {/* Outside the toggle button: a "select all" nested inside a collapse
            control would fold the list every time you used it. */}
        {actions && isOpen && <div className="cs-actions">{actions}</div>}
      </div>

      {isOpen && <div className="cs-body">{children}</div>}

      <style>{`
        .cs { display: flex; flex-direction: column; gap: 8px; }
        .cs-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .cs-toggle {
          display: inline-flex; align-items: center; gap: 6px;
          background: none; border: none; padding: 2px 0; cursor: pointer;
          color: var(--ink); text-align: left; min-width: 0;
        }
        .cs-chev { color: var(--ink-faint); flex-shrink: 0; transition: transform .12s; }
        .cs-open { transform: rotate(180deg); }
        /* inline-flex so a caller can put an icon in the title (registry
           hygiene does) without it sitting on a different baseline. */
        .cs-title { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
        .cs-count {
          font-size: 11.5px; font-weight: 700; padding: 0 7px; border-radius: 999px;
          background: var(--paper-sunken); color: var(--ink-soft); border: 1px solid var(--line);
        }
        .cs-hidden-note { font-size: 11.5px; color: var(--ink-faint); font-style: italic; }
        .cs-toggle:hover .cs-title { color: var(--accent); }
        .cs-toggle:hover .cs-chev { color: var(--accent); }
        .cs-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .cs-body { display: flex; flex-direction: column; gap: 8px; }
      `}</style>
    </div>
  )
}
