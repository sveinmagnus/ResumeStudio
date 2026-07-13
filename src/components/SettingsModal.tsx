import { useCallback, useEffect, useState } from 'react'
import {
  X, Loader2, Check, AlertCircle, Languages, FolderSync, Server, Box, Power, Settings,
  RefreshCw, Download,
} from 'lucide-react'
import {
  api, type SettingsStatus, type SettingsUpdate, type UpdateStatus, UnauthorizedError,
} from '../lib/api'
import { resetTranslationAvailability } from '../lib/translateClient'
import { useDialog } from './ui/useDialog'
import { useStore } from '../store/useStore'
import { downloadBackup } from '../lib/backup'

/** UI-level provider choice. LibreTranslate splits into two entries (the
 *  underlying provider is the same; only translate_docker differs). */
type UiProvider = 'off' | 'libre_docker' | 'libre_remote' | 'deepl' | 'google' | 'azure'

interface SettingsModalProps {
  onClose: () => void
  /** Called after a successful save so the picker can refresh sync status etc. */
  onChanged: () => void
  onUnauthorized: () => void
}

/**
 * Download a portable JSON backup of the CURRENT resume. Moved here from the
 * top bar (it's an occasional action, not something done every session).
 * Distinct from the auto-sync backup FOLDER: this is a manual, one-off copy of
 * the open resume that can be re-imported from the picker as a new resume.
 */
function SaveToFileSection() {
  const resume = useStore((s) => s.data.resume)
  return (
    <section className="sm-sec">
      <div className="sm-sec-head"><Download size={15} /> Save this resume to a file</div>
      <p className="sm-help">
        Download a portable JSON copy of the resume you're editing. Load it later
        from the resume picker — it creates a new resume. This is a manual, one-off
        copy, separate from the auto-synced backup folder.
      </p>
      <div className="sm-btn-row">
        <button
          className="sm-btn"
          onClick={() => downloadBackup(useStore.getState().data)}
          disabled={!resume}
        >
          <Download size={13} /> Save to file
        </button>
      </div>
    </section>
  )
}

/**
 * In-app settings (desktop build). Lets the user pick a translation provider
 * (off / LibreTranslate local-Docker or remote / DeepL / Google / Azure) with
 * its API key, and set the cloud-sync backup folder. On a server build the API
 * reports `managed:false` and this renders a read-only explanation instead.
 */
export function SettingsModal({ onClose, onChanged, onUnauthorized }: SettingsModalProps) {
  const dialogRef = useDialog(onClose)
  const [status, setStatus] = useState<SettingsStatus | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  // Form state
  const [provider, setProvider] = useState<UiProvider>('off')
  const [libreUrl, setLibreUrl] = useState('')
  const [azureRegion, setAzureRegion] = useState('')
  const [backupDir, setBackupDir] = useState('')
  // API keys — empty means "unchanged" (the stored key is masked). `*Set` tracks
  // whether a key is already saved, to show a "(saved)" placeholder.
  const [keys, setKeys] = useState({ libre: '', deepl: '', google: '', azure: '' })
  const [keySet, setKeySet] = useState({ libre: false, deepl: false, google: false, azure: false })

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [test, setTest] = useState<{ busy: boolean; text?: string; ok?: boolean }>({ busy: false })
  const [docker, setDocker] = useState<{ busy: boolean; text?: string; ok?: boolean }>({ busy: false })

  // ── Updates (desktop build) ───────────────────────────────────────────────
  const [upd, setUpd] = useState<UpdateStatus | null>(null)
  const [updBusy, setUpdBusy] = useState<null | 'check' | 'install'>(null)

  const seed = useCallback((s: SettingsStatus) => {
    setStatus(s)
    const v = s.settings
    const ui: UiProvider =
      v.translate_provider === 'libretranslate' ? (v.translate_docker ? 'libre_docker' : 'libre_remote')
      : v.translate_provider // 'off' | 'deepl' | 'google' | 'azure'
    setProvider(ui)
    setLibreUrl(v.libretranslate_url)
    setAzureRegion(v.azure_region)
    setBackupDir(v.backup_dir)
    setKeys({ libre: '', deepl: '', google: '', azure: '' })
    setKeySet({
      libre: v.libretranslate_api_key_set, deepl: v.deepl_api_key_set,
      google: v.google_api_key_set, azure: v.azure_api_key_set,
    })
  }, [])

  useEffect(() => {
    api.getSettings()
      .then(seed)
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) { onUnauthorized(); return }
        setLoadErr('Could not load settings.')
      })
    api.updateStatus().then(setUpd).catch(() => setUpd(null))
  }, [seed, onUnauthorized])

  const onCheckUpdate = useCallback(async () => {
    setUpdBusy('check')
    try {
      setUpd(await api.checkForUpdate())
    } catch (err) {
      if (err instanceof UnauthorizedError) { onUnauthorized(); return }
      setUpd((u) => (u ? { ...u, state: 'error', error: (err as Error).message } : u))
    } finally {
      setUpdBusy(null)
    }
  }, [onUnauthorized])

  const onInstallUpdate = useCallback(async () => {
    setUpdBusy('install')
    try {
      await api.installUpdate()
      setUpd(await api.updateStatus())
    } catch (err) {
      if (err instanceof UnauthorizedError) { onUnauthorized(); return }
      setUpd((u) => (u ? { ...u, state: 'error', error: (err as Error).message } : u))
    } finally {
      setUpdBusy(null)
    }
  }, [onUnauthorized])

  // Map the form to a settings update. Keys are only included when (re)typed, so
  // a masked-but-saved key is preserved server-side.
  const buildUpdate = useCallback((): SettingsUpdate => {
    const u: SettingsUpdate = { backup_dir: backupDir.trim() }
    switch (provider) {
      case 'off': u.translate_provider = 'off'; break
      case 'libre_docker': u.translate_provider = 'libretranslate'; u.translate_docker = true; break
      case 'libre_remote':
        u.translate_provider = 'libretranslate'; u.translate_docker = false
        u.libretranslate_url = libreUrl.trim()
        if (keys.libre.trim()) u.libretranslate_api_key = keys.libre.trim()
        break
      case 'deepl': u.translate_provider = 'deepl'; if (keys.deepl.trim()) u.deepl_api_key = keys.deepl.trim(); break
      case 'google': u.translate_provider = 'google'; if (keys.google.trim()) u.google_api_key = keys.google.trim(); break
      case 'azure':
        u.translate_provider = 'azure'; u.azure_region = azureRegion.trim()
        if (keys.azure.trim()) u.azure_api_key = keys.azure.trim()
        break
    }
    return u
  }, [provider, libreUrl, azureRegion, backupDir, keys])

  const onSave = useCallback(async () => {
    setSaving(true); setSaveMsg(null)
    try {
      const next = await api.saveSettings(buildUpdate())
      seed(next)
      // The editor memoizes "is translate configured?" — clear it so the next
      // editor mount re-probes against the new config.
      resetTranslationAvailability()
      setSaveMsg({ ok: true, text: 'Saved.' })
      onChanged()
    } catch (err) {
      if (err instanceof UnauthorizedError) { onUnauthorized(); return }
      setSaveMsg({ ok: false, text: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }, [buildUpdate, seed, onChanged, onUnauthorized])

  const onTest = useCallback(async () => {
    setTest({ busy: true })
    const r = await api.testTranslate(buildUpdate())
    setTest({ busy: false, ok: r.reachable, text: r.message })
  }, [buildUpdate])

  const onDocker = useCallback(async (action: 'start' | 'stop' | 'status') => {
    setDocker({ busy: true })
    const r = await api.translateDocker(action)
    const ok = r.ok ?? r.reachable ?? false
    setDocker({ busy: false, ok, text: r.message })
  }, [])

  const managed = status?.managed === true
  const keyPlaceholder = (set: boolean) => (set ? '•••••• (saved — leave blank to keep)' : 'API key')

  return (
    <div className="sm-backdrop" onClick={onClose}>
      <div className="sm-card" ref={dialogRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Settings">
        <header className="sm-head">
          <Settings size={18} />
          <h2 className="sm-title">Settings</h2>
          <button className="sm-x" onClick={onClose} aria-label="Close settings"><X size={18} /></button>
        </header>

        {!status && !loadErr && (
          <div className="sm-loading"><Loader2 size={18} className="sm-spin" /> Loading…</div>
        )}
        {loadErr && <div className="sm-msg sm-err" role="alert">{loadErr}</div>}

        {status && !managed && (
          <div className="sm-body">
            <div className="sm-note">
              On this deployment, settings are controlled by the server's environment
              variables, not from the app.
            </div>
            <div className="sm-row">
              <span>Translation</span>
              <span className={status.translate.configured ? 'sm-pill sm-pill-ok' : 'sm-pill'}>
                {status.translate.configured ? 'Configured' : 'Off'}
              </span>
            </div>
            <SaveToFileSection />
          </div>
        )}

        {status && managed && (
          <div className="sm-body">
            {/* ── Translation ─────────────────────────────────────────── */}
            <section className="sm-sec">
              <div className="sm-sec-head"><Languages size={15} /> Translation (Draft button)</div>
              <p className="sm-help">
                The “Draft translation” button needs a translation service.
                “Copy from primary” always works without one.
              </p>

              <label className="sm-field-label" htmlFor="sm-provider">Provider</label>
              <select
                id="sm-provider" className="sm-input" value={provider}
                onChange={(e) => setProvider(e.target.value as UiProvider)} aria-label="Translation provider"
              >
                <option value="off">Off — no machine translation</option>
                <option value="libre_docker">LibreTranslate — local (Docker-managed)</option>
                <option value="libre_remote">LibreTranslate — remote URL</option>
                <option value="deepl">DeepL</option>
                <option value="google">Google Cloud Translation</option>
                <option value="azure">Microsoft Azure Translator</option>
              </select>

              {provider === 'libre_docker' && (
                <div className="sm-sub">
                  <p className="sm-help">
                    Runs LibreTranslate in Docker at <code>http://localhost:5000</code>.
                    Requires Docker Desktop; the first start downloads language
                    models (several minutes).
                  </p>
                  <div className="sm-btn-row">
                    <button className="sm-btn" onClick={() => void onDocker('start')} disabled={docker.busy}>
                      {docker.busy ? <Loader2 size={13} className="sm-spin" /> : <Power size={13} />} Start
                    </button>
                    <button className="sm-btn" onClick={() => void onDocker('stop')} disabled={docker.busy}>
                      <Box size={13} /> Stop
                    </button>
                    <button className="sm-btn" onClick={() => void onDocker('status')} disabled={docker.busy}>
                      <Server size={13} /> Check status
                    </button>
                  </div>
                  {docker.text && (
                    <div className={`sm-inline ${docker.ok ? 'sm-ok' : 'sm-warn'}`}>
                      {docker.ok ? <Check size={13} /> : <AlertCircle size={13} />} {docker.text}
                    </div>
                  )}
                  <p className="sm-help">Click <strong>Save</strong> to enable Docker translation on every launch.</p>
                </div>
              )}

              {provider === 'libre_remote' && (
                <div className="sm-sub">
                  <input
                    className="sm-input" placeholder="https://libretranslate.example.com"
                    value={libreUrl} onChange={(e) => setLibreUrl(e.target.value)} aria-label="LibreTranslate URL"
                  />
                  <input
                    className="sm-input" type="password" placeholder={keyPlaceholder(keySet.libre)}
                    value={keys.libre} onChange={(e) => setKeys((k) => ({ ...k, libre: e.target.value }))}
                    aria-label="LibreTranslate API key"
                  />
                </div>
              )}

              {provider === 'deepl' && (
                <div className="sm-sub">
                  <p className="sm-help">A DeepL API key. Free and Pro keys are both supported (auto-detected).</p>
                  <input
                    className="sm-input" type="password" placeholder={keyPlaceholder(keySet.deepl)}
                    value={keys.deepl} onChange={(e) => setKeys((k) => ({ ...k, deepl: e.target.value }))}
                    aria-label="DeepL API key"
                  />
                </div>
              )}

              {provider === 'google' && (
                <div className="sm-sub">
                  <p className="sm-help">A Google Cloud Translation API key (Cloud Translation API enabled).</p>
                  <input
                    className="sm-input" type="password" placeholder={keyPlaceholder(keySet.google)}
                    value={keys.google} onChange={(e) => setKeys((k) => ({ ...k, google: e.target.value }))}
                    aria-label="Google API key"
                  />
                </div>
              )}

              {provider === 'azure' && (
                <div className="sm-sub">
                  <p className="sm-help">An Azure Translator key and its resource region (e.g. <code>westeurope</code>).</p>
                  <input
                    className="sm-input" type="password" placeholder={keyPlaceholder(keySet.azure)}
                    value={keys.azure} onChange={(e) => setKeys((k) => ({ ...k, azure: e.target.value }))}
                    aria-label="Azure API key"
                  />
                  <input
                    className="sm-input" placeholder="Region, e.g. westeurope"
                    value={azureRegion} onChange={(e) => setAzureRegion(e.target.value)} aria-label="Azure region"
                  />
                </div>
              )}

              {provider !== 'off' && provider !== 'libre_docker' && (
                <div className="sm-btn-row">
                  <button className="sm-btn" onClick={() => void onTest()} disabled={test.busy}>
                    {test.busy ? <Loader2 size={13} className="sm-spin" /> : <Server size={13} />} Test connection
                  </button>
                  {test.text && (
                    <span className={`sm-inline ${test.ok ? 'sm-ok' : 'sm-warn'}`}>
                      {test.ok ? <Check size={13} /> : <AlertCircle size={13} />} {test.text}
                    </span>
                  )}
                </div>
              )}
            </section>

            {/* ── Sync & backup folder ────────────────────────────────── */}
            <section className="sm-sec">
              <div className="sm-sec-head"><FolderSync size={15} /> Backup &amp; sync folder</div>
              <p className="sm-help">
                Paste the path to a cloud-synced folder (Google Drive / Dropbox /
                OneDrive). Resume Studio keeps one backup file there and merges
                newer content from it on launch — point a second computer at the
                same folder to share your CVs. Leave blank to turn sync off.
              </p>
              <input
                className="sm-input" placeholder="e.g. C:\Users\you\Google Drive\ResumeStudio"
                value={backupDir} onChange={(e) => setBackupDir(e.target.value)} aria-label="Backup folder"
              />
            </section>

            {/* ── Save this resume to a file ──────────────────────────── */}
            <SaveToFileSection />

            {/* ── Updates ─────────────────────────────────────────────── */}
            {upd?.supported && (
              <section className="sm-sec">
                <div className="sm-sec-head"><Download size={15} /> Updates</div>
                <div className="sm-row">
                  <span>Current version</span>
                  <span className="sm-pill">v{upd.currentVersion}</span>
                </div>
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
                  <div className="sm-inline"><Loader2 size={13} className="sm-spin" /> {upd.state === 'downloading' ? `Downloading… ${Math.round(upd.progress * 100)}%` : 'Installing — the app will restart.'}</div>
                )}
                {upd.state === 'error' && upd.error && (
                  <div className="sm-inline sm-warn"><AlertCircle size={13} /> {upd.error}</div>
                )}
              </section>
            )}

            {saveMsg && <div className={`sm-msg ${saveMsg.ok ? 'sm-ok-box' : 'sm-err'}`} role={saveMsg.ok ? 'status' : 'alert'}>{saveMsg.text}</div>}

            <div className="sm-foot">
              <button className="sm-btn sm-ghost" onClick={onClose}>Close</button>
              <button className="sm-btn sm-primary" onClick={() => void onSave()} disabled={saving}>
                {saving ? <Loader2 size={14} className="sm-spin" /> : <Check size={14} />} Save
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .sm-backdrop {
          position: fixed; inset: 0; z-index: 50;
          background: rgba(15,23,42,.45); backdrop-filter: blur(2px);
          display: flex; align-items: flex-start; justify-content: center;
          padding: 48px 16px; overflow-y: auto;
        }
        .sm-card {
          width: 100%; max-width: 560px; background: var(--paper);
          border: 1px solid var(--line); border-radius: var(--r-lg);
          box-shadow: var(--shadow-lg); overflow: hidden;
        }
        .sm-head {
          display: flex; align-items: center; gap: 9px;
          padding: 16px 18px; border-bottom: 1px solid var(--line);
          color: var(--accent);
        }
        .sm-title { font-size: 17px; font-weight: 600; flex: 1; }
        .sm-x { color: var(--ink-faint); display: grid; place-items: center; }
        .sm-x:hover { color: var(--ink); }
        .sm-loading { padding: 28px; display: flex; align-items: center; gap: 8px; color: var(--ink-faint); justify-content: center; }
        .sm-body { padding: 18px; }
        .sm-note {
          padding: 10px 14px; background: var(--accent-wash); color: var(--ink-soft);
          border-radius: var(--r-sm); font-size: 13px; margin-bottom: 12px;
        }
        .sm-row { display: flex; align-items: center; justify-content: space-between; font-size: 14px; padding: 6px 0; }
        .sm-pill { padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; background: var(--paper-sunken); color: var(--ink-faint); }
        .sm-pill-ok { background: #e8f6ee; color: #18794e; }
        .sm-sec { padding: 4px 0 16px; border-bottom: 1px solid var(--line); margin-bottom: 16px; }
        .sm-sec:last-of-type { border-bottom: none; margin-bottom: 8px; }
        .sm-sec-head { display: flex; align-items: center; gap: 7px; font-weight: 600; font-size: 14px; color: var(--ink); margin-bottom: 6px; }
        .sm-help { font-size: 12.5px; color: var(--ink-faint); margin: 4px 0 10px; line-height: 1.5; }
        .sm-help code { font-size: 11.5px; background: var(--paper-sunken); padding: 1px 5px; border-radius: 4px; }
        .sm-field-label { display: block; font-size: 12px; font-weight: 600; color: var(--ink-soft); margin-bottom: 5px; }
        .sm-sub { margin: 10px 0 8px; display: flex; flex-direction: column; gap: 8px; }
        .sm-input {
          width: 100%; padding: 8px 11px; font-size: 13px;
          border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper); color: var(--ink);
        }
        .sm-input:focus { outline: none; border-color: var(--accent); }
        .sm-btn-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
        .sm-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 12px; border-radius: var(--r-sm);
          border: 1px solid var(--line); background: var(--paper);
          color: var(--ink); font-size: 12.5px; font-weight: 600;
        }
        .sm-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
        .sm-btn:disabled { opacity: .5; cursor: default; }
        .sm-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
        .sm-primary:hover:not(:disabled) { background: var(--accent-bright); color: #fff; }
        .sm-ghost { background: transparent; }
        .sm-inline { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; }
        .sm-ok { color: #18794e; }
        .sm-warn { color: var(--warn-ink); }
        .sm-msg { margin: 6px 0 12px; padding: 9px 13px; border-radius: var(--r-sm); font-size: 13px; }
        .sm-ok-box { background: #e8f6ee; color: #18794e; }
        .sm-err { background: #fef2f2; color: #b91c1c; }
        .sm-foot { display: flex; justify-content: flex-end; gap: 10px; padding-top: 6px; }
        .sm-spin { animation: sm-spin 1s linear infinite; }
        @keyframes sm-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
