import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, X, Sparkles, AlertCircle } from 'lucide-react'
import { api, type UpdateStatus, UnauthorizedError } from '../lib/api'

interface UpdateBannerProps {
  onUnauthorized: () => void
}

/**
 * "Update available" banner for the picker. Only renders on the desktop build
 * (the server reports `supported:true`) when a newer release has been found —
 * on web/VPS, or when up to date, it renders nothing.
 *
 * It mirrors the tray's update state (both read the same server runtime): the
 * user can install from here OR the tray. After clicking Install the app
 * downloads, swaps files and restarts, so this turns into a "restarting…" note.
 */
export function UpdateBanner({ onUnauthorized }: UpdateBannerProps) {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(() => {
    api.updateStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  useEffect(() => {
    refresh()
    // Poll while mounted so a background (daily) check or an in-progress
    // download is reflected without a manual reload.
    const t = setInterval(refresh, 15_000)
    return () => clearInterval(t)
  }, [refresh])

  const onInstall = useCallback(async () => {
    setInstalling(true); setErr(null)
    try {
      await api.installUpdate()
      refresh() // flips state → downloading/applying
    } catch (e) {
      if (e instanceof UnauthorizedError) { onUnauthorized(); return }
      setErr((e as Error).message)
      setInstalling(false)
    }
  }, [refresh, onUnauthorized])

  if (!status || !status.supported) return null

  const downloading = status.state === 'downloading'
  const applying = status.state === 'applying' || status.state === 'staged'
  const busy = installing || downloading || applying
  // Show only when an update is available (or an install is mid-flight).
  if (!status.updateAvailable && !busy) return null
  if (dismissed && !busy) return null

  return (
    <div className="ub-banner">
      <div className="ub-icon">
        {applying ? <Loader2 size={18} className="ub-spin" /> : <Sparkles size={18} />}
      </div>
      <div className="ub-text">
        {downloading ? (
          <>
            <strong>Downloading update…</strong> {Math.round(status.progress * 100)}%
          </>
        ) : applying ? (
          <>
            <strong>Installing update…</strong> Resume Studio will restart in a moment.
          </>
        ) : (
          <>
            <strong>Resume Studio v{status.latestVersion} is available.</strong>{' '}
            <span className="ub-cur">You have v{status.currentVersion}.</span>
          </>
        )}
        {err && <div className="ub-err"><AlertCircle size={12} /> {err}</div>}
      </div>

      {!busy && (
        <div className="ub-actions">
          {status.htmlUrl && (
            <a className="ub-link" href={status.htmlUrl} target="_blank" rel="noopener noreferrer">
              {status.downloadable ? 'Release notes' : 'Download from GitHub'}
            </a>
          )}
          {status.downloadable && (
            <button className="ub-install" onClick={() => void onInstall()}>
              <Download size={14} /> Install update
            </button>
          )}
          <button className="ub-x" onClick={() => setDismissed(true)} aria-label="Dismiss" title="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}

      <style>{`
        .ub-banner {
          display: flex; align-items: center; gap: 12px;
          margin-bottom: 20px; padding: 12px 16px;
          background: var(--accent-wash); border: 1px solid var(--accent);
          border-radius: var(--r-lg); color: var(--ink);
        }
        .ub-icon {
          display: grid; place-items: center; width: 34px; height: 34px;
          border-radius: var(--r-sm); background: var(--accent); color: #fff;
          flex-shrink: 0;
        }
        .ub-text { flex: 1; min-width: 0; font-size: 13.5px; line-height: 1.45; }
        .ub-cur { color: var(--ink-faint); }
        .ub-err { display: flex; align-items: center; gap: 5px; margin-top: 4px;
          font-size: 12px; color: #b91c1c; }
        .ub-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .ub-link { font-size: 12.5px; color: var(--accent); text-decoration: none; }
        .ub-link:hover { text-decoration: underline; }
        .ub-install {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 8px 14px; border-radius: var(--r-md);
          background: var(--accent); color: #fff; font-weight: 600; font-size: 12.5px;
          transition: background .15s;
        }
        .ub-install:hover { background: var(--accent-bright); }
        .ub-x { display: grid; place-items: center; width: 30px; height: 30px;
          color: var(--ink-faint); border-radius: var(--r-sm); }
        .ub-x:hover { color: var(--ink); background: var(--paper); }
        .ub-spin { animation: ub-spin 1s linear infinite; }
        @keyframes ub-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
