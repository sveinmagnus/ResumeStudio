/**
 * Version & updates — the default tab. It's the thing people open Settings to
 * check most often ("what am I running / is there a new one?"), and unlike the
 * others it's read-mostly: nothing here is part of the Save form.
 *
 * Update INSTALL is desktop-only (`upd.supported`); a server/VPS build reports
 * unsupported and only sees the version, because a server must never rewrite
 * its own files (see updater.ts / CLAUDE.md §14).
 */

import { Loader2, Check, AlertCircle, Download, RefreshCw } from 'lucide-react'
import { useSettingsForm } from './context'

export function VersionTab() {
  const { upd, updBusy, onCheckUpdate, onInstallUpdate } = useSettingsForm()

  return (
    <section className="sm-sec">
      <div className="sm-sec-head"><Download size={15} /> Version &amp; updates</div>

      <div className="sm-row">
        <span>Current version</span>
        <span className="sm-pill">{upd ? `v${upd.currentVersion}` : '…'}</span>
      </div>

      {!upd?.supported && (
        <p className="sm-help">
          This build doesn't update itself — it's installed and upgraded by
          whoever runs the server.
        </p>
      )}

      {upd?.supported && (
        <>
          <div className="sm-btn-row">
            <button className="sm-btn" onClick={() => void onCheckUpdate()} disabled={updBusy !== null}>
              {updBusy === 'check' ? <Loader2 size={13} className="sm-spin" /> : <RefreshCw size={13} />}
              Check for updates
            </button>
            {upd.updateAvailable && upd.downloadable && (
              <button className="sm-btn sm-primary" onClick={() => void onInstallUpdate()} disabled={updBusy !== null}>
                {updBusy === 'install' ? <Loader2 size={13} className="sm-spin" /> : <Download size={13} />}
                Install v{upd.latestVersion}
              </button>
            )}
            {upd.updateAvailable && !upd.downloadable && upd.htmlUrl && (
              <a className="sm-btn" href={upd.htmlUrl} target="_blank" rel="noopener noreferrer">
                <Download size={13} /> Download from GitHub
              </a>
            )}
          </div>
          {upd.state === 'uptodate' && (
            <div className="sm-inline sm-ok"><Check size={13} /> You're on the latest version.</div>
          )}
          {upd.updateAvailable && !['downloading', 'applying'].includes(upd.state) && (
            <div className="sm-inline sm-warn">
              <AlertCircle size={13} /> Version v{upd.latestVersion} is available
              {upd.downloadable ? '.' : ' (manual download for this platform).'}
            </div>
          )}
          {(upd.state === 'downloading' || upd.state === 'applying') && (
            <div className="sm-inline">
              <Loader2 size={13} className="sm-spin" />{' '}
              {upd.state === 'downloading'
                ? `Downloading… ${Math.round(upd.progress * 100)}%`
                : 'Installing — the app will restart.'}
            </div>
          )}
          {upd.state === 'error' && upd.error && (
            <div className="sm-inline sm-warn"><AlertCircle size={13} /> {upd.error}</div>
          )}
        </>
      )}
    </section>
  )
}
