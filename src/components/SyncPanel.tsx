import { useCallback, useEffect, useState } from 'react'
import {
  UploadCloud, DownloadCloud, RefreshCw, Check, Loader2, AlertCircle, FolderSync, FolderClock,
} from 'lucide-react'
import { api, type BackupStatus, UnauthorizedError } from '../lib/api'
import { confirmDialog } from './ui/ConfirmDialog'
import { fmtRelativeTime } from '../lib/locales'

interface SyncPanelProps {
  /** Called after a restore changes the DB, so the picker can reload its list. */
  onRestored: () => void
  onUnauthorized: () => void
  /** Center the panel in a max-width column (used on the empty picker state). */
  standalone?: boolean
}

/**
 * Backup panel for the picker. Renders only when the server reports a folder is
 * configured (RESUME_BACKUP_DIR) — otherwise the whole panel is absent.
 *
 * Surfaces the folder: where it lives, how many resume files are in it, whether
 * it's current, and two actions — "Back up now" (publish every resume to the
 * folder) and "Restore" (merge the folder into this machine). The folder holds
 * one file per resume, so the merge is newest-wins per resume and safe to run on
 * a second computer to pull edits made on the first.
 *
 * `status.continuous` decides which of two different things this panel is
 * describing, and the difference is not cosmetic: only the desktop launcher runs
 * a scheduler and a watcher, so anywhere else these two buttons are the ONLY
 * thing that ever moves the folder. Naming that panel "Sync" everywhere is how
 * an operator ends up believing a service is protecting them.
 */
export function SyncPanel({ onRestored, onUnauthorized, standalone }: SyncPanelProps) {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [busy, setBusy] = useState<null | 'backup' | 'restore'>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const refresh = useCallback(() => {
    api.backupStatus().then(setStatus).catch(() => setStatus({ configured: false }))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const onBackup = useCallback(async () => {
    setBusy('backup'); setMsg(null)
    try {
      const r = await api.backupNow()
      setMsg({
        kind: 'ok',
        text: `Backed up ${r.resumeCount} resume${r.resumeCount === 1 ? '' : 's'} ` +
          `to your sync folder — one file each.`,
      })
      refresh()
    } catch (err) {
      if (err instanceof UnauthorizedError) { onUnauthorized(); return }
      setMsg({ kind: 'err', text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }, [refresh, onUnauthorized])

  const onRestore = useCallback(async () => {
    const ok = await confirmDialog({
      title: 'Restore from your sync folder?',
      message:
        'This merges the folder into this computer: any resume that is newer in the ' +
        'folder replaces the local copy, and resumes you don\'t have yet are added. ' +
        'Resumes deleted on another computer are removed here too. A snapshot is kept ' +
        'so you can undo a restore from History.',
      confirmLabel: 'Restore',
    })
    if (!ok) return
    setBusy('restore'); setMsg(null)
    try {
      const r = await api.restoreBackup('merge')
      const parts: string[] = []
      if (r.inserted) parts.push(`${r.inserted} added`)
      if (r.updated) parts.push(`${r.updated} updated`)
      if (r.deleted) parts.push(`${r.deleted} removed`)
      if (!parts.length) parts.push('already up to date')
      setMsg({ kind: 'ok', text: `Restore complete — ${parts.join(', ')}.` })
      refresh()
      onRestored()
    } catch (err) {
      if (err instanceof UnauthorizedError) { onUnauthorized(); return }
      setMsg({ kind: 'err', text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }, [refresh, onRestored, onUnauthorized])

  // Hidden entirely until we know a folder is configured.
  if (!status || !status.configured) return null

  const fresh = status.exists && status.upToDate
  const continuous = status.continuous

  return (
    <div className={standalone ? 'sp-panel sp-standalone' : 'sp-panel'}>
      <div className="sp-head">
        {continuous ? <FolderSync size={16} /> : <FolderClock size={16} />}
        <span className="sp-title">{continuous ? 'Sync & backup' : 'Backup'}</span>
        {status.exists && (
          <span className={`sp-badge ${fresh ? 'sp-badge-ok' : 'sp-badge-stale'}`}>
            {fresh ? <Check size={12} /> : <AlertCircle size={12} />}
            {fresh ? 'Up to date' : 'Changes not yet backed up'}
          </span>
        )}
      </div>

      <div className="sp-folder" title={status.dir}>
        Folder: <code>{status.dir}</code>
      </div>
      <div className={continuous ? 'sp-mode' : 'sp-mode sp-mode-manual'}>
        {continuous ? (
          <>
            This computer keeps the folder current on its own, and merges in what
            other computers publish to it.
          </>
        ) : (
          <>
            <strong>Manual backup only on this deployment.</strong> Nothing runs in
            the background: “Back up now” writes every resume to the folder, and
            “Restore from folder” reads back what is there. To have it happen on its
            own, schedule a job that calls <code>POST /api/backup/now</code>.
          </>
        )}
      </div>

      <div className="sp-meta">
        {status.exists
          ? <>Last backup {status.lastBackupAt ? fmtRelativeTime(status.lastBackupAt) : 'unknown'}
              {status.backupResumeCount != null && ` · ${status.backupResumeCount} resume${status.backupResumeCount === 1 ? '' : 's'}, one file each`}</>
          : 'No resume files written to this folder yet.'}
      </div>
      {status.legacyFile && (
        <div className="sp-meta sp-legacy">
          This folder still has the old combined backup file
          (<code>{status.legacyFile}</code>). It will be replaced by one file per
          resume the next time this computer backs up.
        </div>
      )}

      {msg && (
        <div className={`sp-msg ${msg.kind === 'ok' ? 'sp-msg-ok' : 'sp-msg-err'}`} role={msg.kind === 'ok' ? 'status' : 'alert'}>{msg.text}</div>
      )}

      <div className="sp-actions">
        <button className="sp-btn sp-btn-primary" onClick={() => void onBackup()} disabled={busy !== null}>
          {busy === 'backup' ? <Loader2 size={14} className="sp-spin" /> : <UploadCloud size={14} />}
          Back up now
        </button>
        <button className="sp-btn" onClick={() => void onRestore()} disabled={busy !== null || !status.exists}>
          {busy === 'restore' ? <Loader2 size={14} className="sp-spin" /> : <DownloadCloud size={14} />}
          Restore from folder
        </button>
        <button className="sp-btn sp-btn-ghost" onClick={refresh} disabled={busy !== null} title="Refresh status" aria-label="Refresh sync status">
          <RefreshCw size={13} />
        </button>
      </div>

      <style>{`
        .sp-panel {
          margin-bottom: 24px; padding: 16px 18px;
          background: var(--paper-raised); border: 1px solid var(--line);
          border-radius: var(--r-lg);
        }
        .sp-standalone {
          max-width: 720px; margin: 40px auto 0;
          width: calc(100% - 80px);
        }
        .sp-head { display: flex; align-items: center; gap: 8px; color: var(--accent); }
        .sp-title { font-weight: 600; font-size: 14px; }
        .sp-badge {
          display: inline-flex; align-items: center; gap: 4px;
          margin-left: auto; padding: 3px 9px; border-radius: 999px;
          font-size: 11px; font-weight: 600;
        }
        .sp-badge-ok { background: #e8f6ee; color: #18794e; }
        .sp-badge-stale { background: var(--warn-wash); color: var(--warn-ink); }
        .sp-folder { margin-top: 10px; font-size: 12.5px; color: var(--ink-soft); }
        .sp-folder code {
          font-size: 12px; color: var(--ink); background: var(--paper-sunken);
          padding: 1px 6px; border-radius: var(--r-sm);
          word-break: break-all;
        }
        .sp-mode { margin-top: 9px; font-size: 12.5px; line-height: 1.55; color: var(--ink-soft); }
        .sp-mode-manual {
          padding: 9px 12px; border-radius: var(--r-sm);
          background: var(--paper-sunken); border: 1px solid var(--line);
        }
        .sp-mode code {
          font-size: 11.5px; color: var(--ink); background: var(--paper);
          padding: 1px 5px; border-radius: var(--r-sm);
        }
        .sp-meta { margin-top: 5px; font-size: 12px; color: var(--ink-faint); }
        .sp-legacy { color: var(--warn-ink); }
        .sp-legacy code { font-size: 11.5px; }
        .sp-msg { margin-top: 10px; padding: 8px 12px; border-radius: var(--r-sm); font-size: 12.5px; }
        .sp-msg-ok { background: var(--ok-wash); color: var(--ok-ink); }
        .sp-msg-err { background: var(--err-wash); color: var(--err-ink); }
        .sp-actions { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
        .sp-btn {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 8px 14px; border-radius: var(--r-md);
          border: 1px solid var(--line); background: var(--paper);
          color: var(--ink); font-weight: 600; font-size: 12.5px;
          transition: border-color .12s, background .12s, color .12s;
        }
        .sp-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
        .sp-btn:disabled { opacity: .5; cursor: default; }
        .sp-btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
        .sp-btn-primary:hover:not(:disabled) { background: var(--accent-bright); color: #fff; }
        .sp-btn-ghost { padding: 8px 10px; }
        .sp-spin { animation: sp-spin 1s linear infinite; }
        @keyframes sp-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
