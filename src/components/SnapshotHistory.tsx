import { useEffect, useState } from 'react'
import { History, RotateCcw, X, Loader2 } from 'lucide-react'
import { useDialog } from './ui/useDialog'
import { useStore } from '../store/useStore'
import { api, type SnapshotMeta, UnauthorizedError } from '../lib/api'
import { fmtRelativeTime } from '../lib/locales'
import { reattachImages } from '../lib/snapshotImages'
import { migrateStore } from '../lib/migrate'

interface SnapshotHistoryProps {
  resumeId: string
  onClose: () => void
  /** Surfaced when a restore hits a 401 so the shell can show the auth modal. */
  onUnauthorized?: () => void
}

/**
 * Modal listing server-side save snapshots with a per-row Restore action.
 *
 * Restores route through `replaceData` (not `loadStore`) so the restored
 * state is treated as a user mutation: it lands in the undo stack and is
 * re-saved to the server. That makes "restore" itself reversible.
 */
export function SnapshotHistory({ resumeId, onClose, onUnauthorized }: SnapshotHistoryProps) {
  const dialogRef = useDialog(onClose)
  const replaceData = useStore((s) => s.replaceData)
  const [snapshots, setSnapshots] = useState<SnapshotMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    api.listSnapshots(resumeId)
      .then((list) => { if (active) setSnapshots(list) })
      .catch((e: unknown) => {
        if (!active) return
        if (e instanceof UnauthorizedError) { onUnauthorized?.(); onClose(); return }
        setError('Could not load history — is the server reachable?')
        setSnapshots([])
      })
    return () => { active = false }
  }, [resumeId, onClose, onUnauthorized])

  const restore = async (snap: SnapshotMeta) => {
    const when = fmtRelativeTime(snap.saved_at)
    if (!window.confirm(`Restore the version from ${when}? Your current data will be replaced — you can undo this afterwards.`)) {
      return
    }
    setRestoringId(snap.id)
    setError(null)
    try {
      const data = await api.getSnapshot(resumeId, snap.id)
      // Snapshots are stored image-free (see server/db.ts) — carry the current
      // images over so restoring content never silently deletes the photo/logo.
      // Old snapshots may predate a shape migration, so bring them current too:
      // replaceData itself never migrates (in-app data is current by
      // construction), making this restore site responsible.
      replaceData(migrateStore(reattachImages(data, useStore.getState().data)))
      onClose()
    } catch (e) {
      if (e instanceof UnauthorizedError) { onUnauthorized?.(); onClose(); return }
      setError('Could not restore this snapshot.')
      setRestoringId(null)
    }
  }

  return (
    <div className="sh-overlay" role="dialog" aria-modal="true" aria-label="Version history" onClick={onClose}>
      <div className="sh-modal" ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <div className="sh-head">
          <span className="sh-title"><History size={16} /> Version history</span>
          <button className="sh-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <p className="sh-sub">
          Snapshots are saved automatically on the server (newest first, last 50 kept).
          Restoring replaces your current data and can be undone.
        </p>

        <div className="sh-body">
          {snapshots === null && (
            <div className="sh-state"><Loader2 size={16} className="sh-spin" /> Loading…</div>
          )}
          {snapshots !== null && snapshots.length === 0 && !error && (
            <div className="sh-state">No snapshots yet — they appear after your first save.</div>
          )}
          {error && <div className="sh-error" role="alert">{error}</div>}

          {snapshots && snapshots.length > 0 && (
            <ul className="sh-list">
              {snapshots.map((s, i) => (
                <li key={s.id} className="sh-row">
                  <div className="sh-info">
                    <span className="sh-when">
                      {fmtRelativeTime(s.saved_at)}
                      {s.saved_by && <span className="sh-by">by {s.saved_by}</span>}
                      {i === 0 && <span className="sh-badge">latest</span>}
                    </span>
                    <span className="sh-abs">{new Date(s.saved_at).toLocaleString()}</span>
                  </div>
                  <button
                    className="sh-restore"
                    onClick={() => void restore(s)}
                    disabled={restoringId !== null}
                  >
                    {restoringId === s.id
                      ? <><Loader2 size={13} className="sh-spin" /> Restoring…</>
                      : <><RotateCcw size={13} /> Restore</>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <style>{`
        .sh-overlay {
          position: fixed; inset: 0; background: rgba(15, 23, 42, .45);
          display: flex; align-items: center; justify-content: center;
          z-index: 100; padding: 24px; animation: fadeIn .15s ease;
        }
        .sh-modal {
          background: var(--paper); border-radius: var(--r-lg);
          box-shadow: var(--shadow-lg); width: 100%; max-width: 520px;
          max-height: 80vh; display: flex; flex-direction: column;
          padding: 22px 24px; animation: fadeUp .2s ease;
        }
        .sh-head { display: flex; align-items: center; justify-content: space-between; }
        .sh-title { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; }
        .sh-close { color: var(--ink-faint); padding: 4px; border-radius: var(--r-sm); transition: all .12s; }
        .sh-close:hover { background: var(--paper-sunken); color: var(--ink); }
        .sh-sub { font-size: 12.5px; color: var(--ink-soft); margin: 8px 0 16px; line-height: 1.5; }
        .sh-body { overflow-y: auto; overscroll-behavior: contain; }
        .sh-state { padding: 28px 8px; text-align: center; color: var(--ink-faint); font-size: 14px;
          display: flex; align-items: center; justify-content: center; gap: 8px; }
        .sh-error { padding: 14px; background: #fef2f2; color: #b91c1c; border-radius: var(--r-sm); font-size: 13px; }
        .sh-list { list-style: none; display: flex; flex-direction: column; gap: 4px; }
        .sh-row {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-md);
          transition: border-color .12s;
        }
        .sh-row:hover { border-color: var(--accent); }
        .sh-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .sh-when { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
        .sh-badge {
          font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
          background: var(--accent-wash); color: var(--accent); padding: 1px 6px; border-radius: 8px;
        }
        .sh-by { font-size: 11px; color: var(--ink-faint); font-weight: 400; }
        .sh-abs { font-size: 11px; color: var(--ink-faint); }
        .sh-restore {
          display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
          padding: 7px 13px; background: var(--accent-wash); color: var(--accent);
          border-radius: var(--r-sm); font-size: 13px; font-weight: 600; transition: all .13s;
        }
        .sh-restore:hover:not(:disabled) { background: var(--accent); color: #fff; }
        .sh-restore:disabled { opacity: .5; cursor: default; }
        .sh-spin { animation: sh-spin 1s linear infinite; }
        @keyframes sh-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
