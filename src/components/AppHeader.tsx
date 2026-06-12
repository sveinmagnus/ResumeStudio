import { useEffect, useRef, useState } from 'react'
import { Download, Undo2, Redo2, History, ChevronDown, FileText, Menu } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useUndoRedo } from '../store/useUndoRedo'
import { SaveStatus, type SaveState } from './layout/SaveStatus'
import { LanguageSwitcher } from './layout/LanguageSwitcher'
import { SnapshotHistory } from './SnapshotHistory'
import { downloadBackup } from '../lib/backup'
import { api, type ResumeMeta, UnauthorizedError } from '../lib/api'
import { Link, navigate } from '../lib/router'
import type { SectionDef } from '../lib/sections'

interface AppHeaderProps {
  resumeId: string
  section: SectionDef | undefined
  saveState: SaveState
  cacheSavedAt: string | null
  unsyncedCount?: number
  onRetry: () => void
  onUnauthorized: () => void
  /** Re-open the conflict resolver from the SaveStatus "Resolve" affordance. */
  onResolveConflict?: () => void
  /** Open the navigation drawer (only visible on narrow viewports). */
  onOpenSidebar?: () => void
}

/**
 * The editor's top bar: resume switcher, breadcrumb/title, save status,
 * undo/redo, language switcher, history, backup-export. The load-file
 * affordance moved to the picker (decision 6 — backup load is always
 * "create a new resume").
 *
 * Layout note: the title block and control cluster sit at opposite ends of a
 * flex-wrap row at desktop width. As the viewport shrinks the cluster wraps
 * underneath the title, then individual buttons collapse their text labels
 * (icon-only). At the same ~880px breakpoint the Sidebar collapses into a
 * drawer and a Menu button appears at the leading edge of the header.
 */
export function AppHeader({
  resumeId, section, saveState, cacheSavedAt, unsyncedCount, onRetry, onUnauthorized,
  onResolveConflict, onOpenSidebar,
}: AppHeaderProps) {
  const { undo, redo, canUndo, canRedo } = useUndoRedo()
  const [showHistory, setShowHistory] = useState(false)

  return (
    <header className="app-header">
      {showHistory && (
        <SnapshotHistory
          resumeId={resumeId}
          onClose={() => setShowHistory(false)}
          onUnauthorized={onUnauthorized}
        />
      )}

      <div className="ah-lead">
        {/* Hamburger toggles the Sidebar drawer. CSS hides it on wide screens
            (the sidebar is already in-flow there). */}
        <button
          type="button"
          className="ah-menu"
          onClick={() => onOpenSidebar?.()}
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </button>

        <div className="ah-titles">
          <ResumeSwitcher
            resumeId={resumeId}
            onUnauthorized={onUnauthorized}
          />
          <div className="ah-crumb">{section?.group}</div>
          <h1 className="ah-title">{section?.label}</h1>
        </div>
      </div>

      <div className="ah-controls">
        <SaveStatus state={saveState} cacheSavedAt={cacheSavedAt} unsyncedCount={unsyncedCount} onRetry={onRetry} onResolve={onResolveConflict} />
        <div className="ah-history">
          <button
            className="ah-hist-btn"
            onClick={undo}
            disabled={!canUndo}
            title="Undo (Ctrl/Cmd+Z)"
            aria-label="Undo"
          >
            <Undo2 size={15} />
          </button>
          <button
            className="ah-hist-btn"
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Ctrl/Cmd+Shift+Z)"
            aria-label="Redo"
          >
            <Redo2 size={15} />
          </button>
        </div>
        <LanguageSwitcher />

        <button
          className="ah-btn-secondary"
          onClick={() => setShowHistory(true)}
          title="Browse and restore earlier saved versions"
          aria-label="History"
        >
          <History size={15} /> <span className="ah-btn-text">History</span>
        </button>

        <button
          className="ah-export"
          onClick={() => downloadBackup(useStore.getState().data)}
          title="Download a portable backup of this resume"
          aria-label="Save to file"
        >
          <Download size={16} /> <span className="ah-btn-text">Save to file</span>
        </button>
      </div>

      <style>{`
        .app-header {
          display: flex; align-items: flex-end; justify-content: space-between;
          gap: 16px 20px; row-gap: 14px;
          padding: 22px 36px 18px; border-bottom: 1px solid var(--line);
          position: sticky; top: 0; background: var(--paper); z-index: 10;
          flex-wrap: wrap;
        }
        .ah-lead { display: flex; align-items: flex-end; gap: 12px; min-width: 0; flex: 1 1 auto; }
        .ah-titles { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .ah-crumb {
          font-size: 11px; font-weight: 600; letter-spacing: .1em;
          text-transform: uppercase; color: var(--accent); margin-top: 6px;
        }
        .ah-title {
          font-size: 30px; margin-top: 2px;
          /* Long section names + an accidentally narrow viewport shouldn't push
             the title off-screen. Wrap rather than overflow. */
          word-break: break-word;
        }

        /* Hamburger — hidden until the drawer breakpoint kicks in. */
        .ah-menu {
          display: none; width: 38px; height: 38px; place-items: center;
          border-radius: var(--r-sm);
          border: 1px solid var(--line); background: var(--paper-raised);
          color: var(--ink-soft); margin-bottom: 6px;
          transition: color .13s, background .13s, border-color .13s, box-shadow .13s;
        }
        .ah-menu:hover { color: var(--accent); border-color: var(--accent); }

        /* Controls cluster: wraps as its own flex row so each item floats to a
           sensible place when the viewport shrinks. align-items:center keeps
           the SaveStatus pill, button group, language box and primary button
           aligned along their visual centres regardless of differing heights. */
        .ah-controls {
          display: flex; align-items: center; gap: 10px;
          flex-wrap: wrap; justify-content: flex-end;
        }
        .ah-history {
          display: inline-flex; align-items: stretch; gap: 1px;
          background: var(--paper-raised); border: 1px solid var(--line);
          border-radius: var(--r-sm); overflow: hidden;
        }
        .ah-hist-btn {
          width: 30px; height: 32px; display: grid; place-items: center;
          color: var(--ink-soft); transition: color .13s, background .13s, border-color .13s, box-shadow .13s;
        }
        .ah-hist-btn:hover:not(:disabled) { background: var(--accent-wash); color: var(--accent); }
        .ah-hist-btn:disabled { opacity: .3; cursor: default; }
        .ah-btn-secondary {
          display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px;
          border: 1.5px solid var(--line-strong); border-radius: var(--r-md);
          font-weight: 600; font-size: 13px; color: var(--ink-soft); transition: color .15s, background .15s, border-color .15s, box-shadow .15s;
        }
        .ah-btn-secondary:hover { border-color: var(--accent); color: var(--accent); }
        .ah-export {
          display: inline-flex; align-items: center; gap: 7px; padding: 11px 18px;
          background: var(--ink); color: var(--paper); border-radius: var(--r-md);
          font-weight: 600; font-size: 14px; transition: color .15s, background .15s, border-color .15s, box-shadow .15s;
        }
        .ah-export:hover { background: var(--accent); }

        /* ── Mid-width: tighter chrome, hamburger appears ─────────────── */
        @media (max-width: 880px) {
          .app-header {
            padding: 16px 20px 14px;
            align-items: flex-start;
          }
          .ah-title { font-size: 24px; }
          .ah-menu { display: grid; }
          .ah-controls {
            /* Let controls flow to a new line under the title rather than
               competing with it for the same row at the right edge. */
            justify-content: flex-start;
            width: 100%;
          }
        }

        /* ── Narrow: icon-only buttons + smaller title ───────────────── */
        @media (max-width: 560px) {
          .app-header { padding: 14px 16px 12px; gap: 10px 12px; row-gap: 10px; }
          .ah-title { font-size: 20px; }
          .ah-crumb { margin-top: 4px; }
          .ah-btn-text { display: none; }
          .ah-btn-secondary { padding: 9px 11px; }
          .ah-export { padding: 9px 12px; }
        }
      `}</style>
    </header>
  )
}

// ── Resume switcher ──────────────────────────────────────────────────────────

interface ResumeSwitcherProps {
  resumeId: string
  onUnauthorized: () => void
}

function ResumeSwitcher({ resumeId, onUnauthorized }: ResumeSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ResumeMeta[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // Preload the list on mount so the trigger shows the current resume's name
  // immediately (rather than a dash until the menu is first opened).
  useEffect(() => {
    let cancelled = false
    api.listResumes()
      .then((r) => { if (!cancelled) setItems(r) })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof UnauthorizedError) { onUnauthorized(); return }
        setItems([])
      })
    return () => { cancelled = true }
  }, [onUnauthorized])

  const current = items?.find((r) => r.id === resumeId)
  const others = items?.filter((r) => r.id !== resumeId) ?? []

  return (
    <div className="rsw" ref={ref}>
      <button
        className="rsw-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <FileText size={13} />
        <span className="rsw-current">{current?.name ?? '…'}</span>
        <ChevronDown size={13} className={open ? 'rsw-chev open' : 'rsw-chev'} />
      </button>

      {open && (
        <div className="rsw-menu" role="menu">
          {items === null && <div className="rsw-state">Loading…</div>}
          {items !== null && others.length === 0 && (
            <div className="rsw-state">No other resumes yet.</div>
          )}
          {others.map((r) => (
            <button
              key={r.id}
              className="rsw-item"
              onClick={() => {
                setOpen(false)
                navigate({ name: 'editor', id: r.id })
              }}
              role="menuitem"
            >
              <FileText size={13} />
              <span className="rsw-name">{r.name}</span>
            </button>
          ))}
          <Link to="/" className="rsw-all" onClick={() => setOpen(false)}>
            All resumes…
          </Link>
        </div>
      )}

      <style>{`
        .rsw { position: relative; display: inline-block; }
        .rsw-trigger {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 4px 10px; border-radius: var(--r-sm);
          color: var(--ink-soft); font-size: 12px; font-weight: 600;
          background: var(--paper-raised); border: 1px solid var(--line);
          transition: color .13s, background .13s, border-color .13s, box-shadow .13s; max-width: 240px;
        }
        .rsw-trigger:hover { border-color: var(--accent); color: var(--accent); }
        .rsw-current {
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          max-width: 180px;
        }
        .rsw-chev { transition: transform .15s; flex-shrink: 0; }
        .rsw-chev.open { transform: rotate(180deg); }

        .rsw-menu {
          position: absolute; top: 100%; left: 0; margin-top: 4px;
          background: var(--paper); border: 1px solid var(--line);
          border-radius: var(--r-md); box-shadow: var(--shadow-md);
          padding: 4px; z-index: 50; min-width: 240px;
          max-width: calc(100vw - 32px);
          display: flex; flex-direction: column; gap: 1px;
          animation: rsw-fade .12s ease;
        }
        @keyframes rsw-fade { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }

        .rsw-state {
          padding: 10px 12px; font-size: 12px; color: var(--ink-faint);
          text-align: center;
        }
        .rsw-item {
          display: flex; align-items: center; gap: 8px;
          padding: 7px 10px; border-radius: var(--r-sm);
          font-size: 13px; color: var(--ink); text-align: left;
          transition: background .12s;
        }
        .rsw-item:hover { background: var(--accent-wash); color: var(--accent); }
        .rsw-name {
          flex: 1; min-width: 0;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .rsw-all {
          display: block; padding: 7px 10px; margin-top: 4px;
          border-top: 1px solid var(--line);
          font-size: 12px; font-weight: 600; color: var(--accent);
          text-decoration: none; text-align: center;
        }
        .rsw-all:hover { background: var(--accent-wash); }

        @media (max-width: 560px) {
          .rsw-current { max-width: 130px; }
        }
      `}</style>
    </div>
  )
}
