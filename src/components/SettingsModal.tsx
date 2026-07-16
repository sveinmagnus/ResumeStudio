import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Loader2, Check, Settings } from 'lucide-react'
import { resetSummarizeAvailability } from '../lib/summarizeClient'
import { modelOptions, type InstalledModel } from '../lib/ollamaCatalog'
import { forcedLanguages, resolveTranslateLanguages, DEFAULT_TRANSLATE_LANGUAGES } from '../lib/translateLanguages'
import {
  api, type SettingsStatus, type SettingsUpdate, type UpdateStatus, UnauthorizedError,
} from '../lib/api'
import { resetTranslationAvailability } from '../lib/translateClient'
import { useDialog } from './ui/useDialog'
import { useStore } from '../store/useStore'
import {
  SettingsFormProvider, type SettingsForm, type UiProvider, type SummUiProvider,
} from './settings/context'
import { SettingsTabs, type TabDef } from './settings/SettingsTabs'
import { VersionTab } from './settings/VersionTab'
import { TranslationTab } from './settings/TranslationTab'
import { AiAssistTab } from './settings/AiAssistTab'
import { SyncTab } from './settings/SyncTab'
import { DefaultFontsSection } from './settings/sections'

/**
 * Version first, and the default: it's what people most often open Settings to
 * check, and it's the only tab that's read-only (nothing on it is part of the
 * Save form), so landing here can't leave half-typed config behind.
 */
const TABS: TabDef[] = [
  { id: 'version', label: 'Version' },
  { id: 'translation', label: 'Translation' },
  { id: 'ai', label: 'AI assist' },
  { id: 'sync', label: 'Sync & backup' },
  { id: 'appearance', label: 'Appearance' },
]

/**
 * Tabs whose fields are part of the server-side Save form. Version is read-only
 * and Appearance is a client preference that persists as you change it, so a
 * Save button on either would be a no-op that implies unsaved work.
 */
const SAVEABLE_TABS = new Set(['translation', 'ai', 'sync'])

interface SettingsModalProps {
  onClose: () => void
  /** Called after a successful save so the picker can refresh sync status etc. */
  onChanged: () => void
  onUnauthorized: () => void
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
  const [tab, setTab] = useState<string>('version')

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
  // Which languages the Docker LibreTranslate installs. The locales the user is
  // editing in can't be deselected — see lib/translateLanguages.ts.
  const [transLangs, setTransLangs] = useState<string[]>(DEFAULT_TRANSLATE_LANGUAGES)
  const primaryLocale = useStore((s) => s.primaryLocale)
  const secondaryLocale = useStore((s) => s.secondaryLocale)
  const forcedLangs = useMemo(
    () => forcedLanguages(primaryLocale, secondaryLocale),
    [primaryLocale, secondaryLocale],
  )

  // Summarize (AI) form state
  const [summProvider, setSummProvider] = useState<SummUiProvider>('off')
  const [summOllamaUrl, setSummOllamaUrl] = useState('')
  const [summCompatUrl, setSummCompatUrl] = useState('')
  const [summModel, setSummModel] = useState('')
  const [summKeys, setSummKeys] = useState({ openai: '', compat: '' })
  const [summKeySet, setSummKeySet] = useState({ openai: false, compat: false })
  const [summTest, setSummTest] = useState<{ busy: boolean; text?: string; ok?: boolean }>({ busy: false })
  const [summDocker, setSummDocker] = useState<{ busy: boolean; text?: string; ok?: boolean }>({ busy: false })
  // Models the running Ollama has pulled, merged with the curated catalog to
  // populate the model datalist. Empty until asked for (or if nothing is up).
  const [installed, setInstalled] = useState<InstalledModel[]>([])
  const [modelsBusy, setModelsBusy] = useState(false)

  // ── Updates (desktop build) ───────────────────────────────────────────────
  const [upd, setUpd] = useState<UpdateStatus | null>(null)
  const [updBusy, setUpdBusy] = useState<null | 'check' | 'install'>(null)

  const seed = useCallback((s: SettingsStatus) => {
    setStatus(s)
    const v = s.settings
    const ui: UiProvider =
      v.translate_provider === 'libretranslate' ? (v.translate_docker ? 'libre_docker' : 'libre_remote')
      : v.translate_provider // 'off' | 'deepl' | 'google' | 'azure' | 'llm'
    setProvider(ui)
    setLibreUrl(v.libretranslate_url)
    setAzureRegion(v.azure_region)
    setTransLangs(v.translate_languages?.length ? v.translate_languages : DEFAULT_TRANSLATE_LANGUAGES)
    setBackupDir(v.backup_dir)
    setKeys({ libre: '', deepl: '', google: '', azure: '' })
    setKeySet({
      libre: v.libretranslate_api_key_set, deepl: v.deepl_api_key_set,
      google: v.google_api_key_set, azure: v.azure_api_key_set,
    })
    const summUi: SummUiProvider =
      v.summarize_provider === 'ollama' ? (v.summarize_docker ? 'ollama_docker' : 'ollama_remote')
      : v.summarize_provider // 'off' | 'openai' | 'compat'
    setSummProvider(summUi || 'off')
    setSummOllamaUrl(v.summarize_ollama_url ?? '')
    setSummCompatUrl(v.summarize_compat_url ?? '')
    setSummModel(v.summarize_model ?? '')
    setSummKeys({ openai: '', compat: '' })
    setSummKeySet({ openai: !!v.summarize_openai_api_key_set, compat: !!v.summarize_compat_api_key_set })
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
      // Carries no config of its own — it borrows the summarize settings below.
      case 'llm': u.translate_provider = 'llm'; break
      case 'libre_docker':
        u.translate_provider = 'libretranslate'; u.translate_docker = true
        // Resolve here (not on change) so the forced locales are always saved,
        // even if the user never touched the list.
        u.translate_languages = resolveTranslateLanguages(transLangs, primaryLocale, secondaryLocale)
        break
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
    u.summarize_model = summModel.trim()
    switch (summProvider) {
      case 'off': u.summarize_provider = 'off'; break
      case 'ollama_docker': u.summarize_provider = 'ollama'; u.summarize_docker = true; break
      case 'ollama_remote':
        u.summarize_provider = 'ollama'; u.summarize_docker = false
        u.summarize_ollama_url = summOllamaUrl.trim()
        break
      case 'openai':
        u.summarize_provider = 'openai'
        if (summKeys.openai.trim()) u.summarize_openai_api_key = summKeys.openai.trim()
        break
      case 'compat':
        u.summarize_provider = 'compat'; u.summarize_compat_url = summCompatUrl.trim()
        if (summKeys.compat.trim()) u.summarize_compat_api_key = summKeys.compat.trim()
        break
    }
    return u
  }, [provider, libreUrl, azureRegion, backupDir, keys, summProvider, summOllamaUrl, summCompatUrl, summModel, summKeys,
      transLangs, primaryLocale, secondaryLocale])

  /**
   * Persist the form. Returns an error string, or null on success — shared by
   * Save and by the "Save and test" buttons, which must not test a config the
   * server isn't actually running.
   */
  const doSave = useCallback(async (): Promise<string | null> => {
    try {
      const next = await api.saveSettings(buildUpdate())
      seed(next)
      // The editor memoizes "is translate/summarize configured?" — clear both
      // so the next mount re-probes against the new config.
      resetTranslationAvailability()
      resetSummarizeAvailability()
      onChanged()
      return null
    } catch (err) {
      if (err instanceof UnauthorizedError) { onUnauthorized(); return 'Unauthorized' }
      return (err as Error).message
    }
  }, [buildUpdate, seed, onChanged, onUnauthorized])

  const onSave = useCallback(async () => {
    setSaving(true); setSaveMsg(null)
    const err = await doSave()
    setSaveMsg(err ? { ok: false, text: err } : { ok: true, text: 'Saved.' })
    setSaving(false)
  }, [doSave])

  /**
   * Save, THEN test — hence the "Save and test" label.
   *
   * Testing the pending form alone was misleading: the probe posts the unsaved
   * values, but some providers ignore them and read the server's live config
   * (the `llm` translator borrows the SAVED summarize settings), so a green
   * "Working" could describe a config that isn't in effect. Saving first makes
   * the result true by construction.
   */
  const onTest = useCallback(async () => {
    setTest({ busy: true })
    const err = await doSave()
    if (err) { setTest({ busy: false, ok: false, text: `Could not save: ${err}` }); return }
    const r = await api.testTranslate(buildUpdate())
    setTest({ busy: false, ok: r.reachable, text: r.message })
  }, [doSave, buildUpdate])

  const onDocker = useCallback(async (action: 'start' | 'stop' | 'status') => {
    setDocker({ busy: true })
    const r = await api.translateDocker(action)
    const ok = r.ok ?? r.reachable ?? false
    setDocker({ busy: false, ok, text: r.message })
  }, [])

  /** Save, then test — see onTest. */
  const onTestSummarize = useCallback(async () => {
    setSummTest({ busy: true })
    const err = await doSave()
    if (err) { setSummTest({ busy: false, ok: false, text: `Could not save: ${err}` }); return }
    const r = await api.testSummarize(buildUpdate())
    setSummTest({ busy: false, ok: r.reachable, text: r.message })
  }, [doSave, buildUpdate])

  const onSummarizeDocker = useCallback(async (action: 'start' | 'stop' | 'status') => {
    setSummDocker({ busy: true })
    const r = await api.summarizeDocker(action, summModel.trim())
    const ok = r.ok ?? r.reachable ?? false
    setSummDocker({ busy: false, ok, text: r.message })
  }, [summModel])

  // The model picker only makes sense for Ollama — OpenAI/compat endpoints have
  // no list we can enumerate, so they keep the plain free-text field.
  const isOllama = summProvider === 'ollama_docker' || summProvider === 'ollama_remote'
  const modelOpts = useMemo(() => modelOptions(installed), [installed])
  const installedCount = installed.length

  const refreshModels = useCallback(async () => {
    setModelsBusy(true)
    setInstalled(await api.summarizeModels())
    setModelsBusy(false)
  }, [])

  // Populate once when the Ollama provider is showing, so the list is there
  // before the user opens it. Cheap, and silently empty if nothing is running.
  useEffect(() => {
    if (isOllama) void refreshModels()
  }, [isOllama, refreshModels])

  const managed = status?.managed === true
  const keyPlaceholder = (set: boolean) => (set ? '•••••• (saved — leave blank to keep)' : 'API key')

  const form: SettingsForm = {
    status, managed, keyPlaceholder,
    provider, setProvider, libreUrl, setLibreUrl, azureRegion, setAzureRegion,
    keys, setKeys, keySet, docker, onDocker, test, onTest,
    transLangs, setTransLangs, forcedLangs,
    summProvider, setSummProvider, summOllamaUrl, setSummOllamaUrl,
    summCompatUrl, setSummCompatUrl, summModel, setSummModel,
    summKeys, setSummKeys, summKeySet, summTest, onTestSummarize,
    summDocker, onSummarizeDocker, isOllama, modelOpts, installed, modelsBusy, refreshModels,
    backupDir, setBackupDir,
    upd, updBusy, onCheckUpdate, onInstallUpdate,
  }

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

        {status && (
          <>
            <SettingsTabs tabs={TABS} active={tab} onChange={setTab} />
            <div
              className="sm-body"
              role="tabpanel"
              id={`sm-panel-${tab}`}
              aria-labelledby={`sm-tab-${tab}`}
              tabIndex={0}
            >
              <SettingsFormProvider value={form}>
                {tab === 'version' && <VersionTab />}
                {tab === 'translation' && <TranslationTab />}
                {tab === 'ai' && <AiAssistTab />}
                {tab === 'sync' && <SyncTab />}
                {tab === 'appearance' && <DefaultFontsSection />}
              </SettingsFormProvider>

              {saveMsg && (
                <div className={`sm-msg ${saveMsg.ok ? 'sm-ok-box' : 'sm-err'}`} role={saveMsg.ok ? 'status' : 'alert'}>
                  {saveMsg.text}
                </div>
              )}

              <div className="sm-foot">
                <button className="sm-btn sm-ghost" onClick={onClose}>Close</button>
                {/* Save only where there IS something to save: Version is
                    read-only and Appearance is a client preference that
                    persists as you change it. */}
                {managed && SAVEABLE_TABS.has(tab) && (
                  <button className="sm-btn sm-primary" onClick={() => void onSave()} disabled={saving}>
                    {saving ? <Loader2 size={14} className="sm-spin" /> : <Check size={14} />} Save
                  </button>
                )}
              </div>
            </div>
          </>
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
        /* Tab bar. Scrolls sideways rather than wrapping — a wrapped bar
           reflows the panel below it as tabs change width. */
        .sm-tabs {
          display: flex; gap: 2px; padding: 0 10px;
          border-bottom: 1px solid var(--line); background: var(--paper-sunken);
          overflow-x: auto; scrollbar-width: thin;
        }
        .sm-tab {
          flex: 0 0 auto; padding: 10px 12px; border: none; background: none;
          font-size: 13px; font-weight: 500; color: var(--ink-soft); cursor: pointer;
          border-bottom: 2px solid transparent; margin-bottom: -1px;
          transition: color .12s, border-color .12s;
          white-space: nowrap;
        }
        .sm-tab:hover { color: var(--accent); }
        .sm-tab.is-active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
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
        /* An input with a trailing icon action (the model field's refresh).
           Distinct from .sm-row, which is a space-between label/value line. */
        .sm-field-row { display: flex; align-items: center; gap: 6px; }
        .sm-field-row .sm-input { flex: 1 1 auto; min-width: 0; }
        .sm-btn-icon { flex: 0 0 auto; padding: 8px 10px; margin-top: 0; }
        /* Translate-install language picker: a compact multi-column checklist
           (15 locales would be a very long single column). */
        .sm-lang-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 2px 10px; margin: 6px 0 4px;
          padding: 8px 10px; background: var(--paper-sunken);
          border: 1px solid var(--line); border-radius: var(--r-sm);
        }
        .sm-lang { display: flex; align-items: center; gap: 7px; font-size: 13px; cursor: pointer; }
        .sm-lang input { accent-color: var(--accent); width: 14px; height: 14px; flex-shrink: 0; }
        /* Forced (editing / pivot) languages read as fixed, not broken. */
        .sm-lang.is-forced { color: var(--ink-faint); cursor: default; }
        .sm-lang.is-forced input { cursor: default; }
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
        .sm-fontlink { margin-top: 8px; color: var(--accent); font-weight: 600; text-decoration: none; }
        .sm-fontlink:hover { text-decoration: underline; }
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
