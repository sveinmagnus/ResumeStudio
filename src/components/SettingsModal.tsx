import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Loader2, Check, Settings } from 'lucide-react'
import { resetLlmAvailability } from '../lib/llmClient'
import { looksHighEnd } from '../lib/llmAssist'
import { resetAssistConsent } from './ui/AssistRun'
import { buildModelOptions, type LiveModel } from '../lib/modelPicker'
import { forcedLanguages, resolveTranslateLanguages, DEFAULT_TRANSLATE_LANGUAGES } from '../lib/translateLanguages'
import {
  api, type SettingsStatus, type SettingsUpdate, type UpdateStatus, UnauthorizedError,
} from '../lib/api'
import { resetTranslationAvailability } from '../lib/translateClient'
import { useDialog } from './ui/useDialog'
import { useStore } from '../store/useStore'
import {
  SettingsFormProvider, type SettingsForm, type UiProvider, type LlmUiProvider,
  type LlmKeys, type LlmKeyName,
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
  /** Which tab to land on. Used when something deep-links into a setting. */
  initialTab?: string
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
export function SettingsModal({ initialTab, onClose, onChanged, onUnauthorized }: SettingsModalProps) {
  const dialogRef = useDialog(onClose)
  const [status, setStatus] = useState<SettingsStatus | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [tab, setTab] = useState<string>(initialTab ?? 'version')

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

  // AI assist form state
  const [llmProvider, setLlmProvider] = useState<LlmUiProvider>('off')
  const [llmOllamaUrl, setLlmOllamaUrl] = useState('')
  const [llmCompatUrl, setLlmCompatUrl] = useState('')
  const [llmModel, setLlmModel] = useState('')
  const [llmKeys, setLlmKeys] = useState<LlmKeys>({ openai: '', anthropic: '', gemini: '', mistral: '', compat: '' })
  const [llmKeySet, setLlmKeySet] = useState<Record<LlmKeyName, boolean>>(
    { openai: false, anthropic: false, gemini: false, mistral: false, compat: false })
  /**
   * "This model is high-end" — the gate on the advanced assists. `touched`
   * tracks whether the USER set it: until they do, changing the model re-runs
   * the `looksHighEnd` suggestion, and once they do it stops second-guessing
   * them. Without that, ticking the box for an unrecognised model id and then
   * fixing a typo in that id would silently untick it again.
   */
  const [llmHighEnd, setLlmHighEnd] = useState(false)
  const [highEndTouched, setHighEndTouched] = useState(false)
  const [llmTest, setLlmTest] = useState<{ busy: boolean; text?: string; ok?: boolean }>({ busy: false })
  const [llmDocker, setLlmDocker] = useState<{ busy: boolean; text?: string; ok?: boolean }>({ busy: false })
  // Models the running Ollama has pulled, merged with the curated catalog to
  // populate the model datalist. Empty until asked for (or if nothing is up).
  const [liveModels, setLiveModels] = useState<LiveModel[]>([])
  const [modelsBusy, setModelsBusy] = useState(false)

  // ── Updates (desktop build) ───────────────────────────────────────────────
  const [upd, setUpd] = useState<UpdateStatus | null>(null)
  const [updBusy, setUpdBusy] = useState<null | 'check' | 'install'>(null)

  const seed = useCallback((s: SettingsStatus) => {
    setStatus(s)
    const v = s.settings
    // Only libretranslate splits into two UI options (Docker vs remote); every
    // other provider passes through as itself.
    const ui: UiProvider =
      v.translate_provider === 'libretranslate' ? (v.translate_docker ? 'libre_docker' : 'libre_remote')
      : v.translate_provider
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
    // Same split as translate: only ollama has a Docker/remote pair.
    const llmUi: LlmUiProvider =
      v.llm_provider === 'ollama' ? (v.llm_docker ? 'ollama_docker' : 'ollama_remote')
      : v.llm_provider
    setLlmProvider(llmUi || 'off')
    setLlmOllamaUrl(v.llm_ollama_url ?? '')
    setLlmCompatUrl(v.llm_compat_url ?? '')
    setLlmModel(v.llm_model ?? '')
    setLlmHighEnd(v.llm_high_end === true)
    // Only a stored TICK counts as a decision to protect: it's an explicit
    // opt-in, and re-suggesting over it could silently untick it when the user
    // edits the model id. A stored `false` is indistinguishable from "never
    // decided" (it's the default), so the suggestion stays live — and it can
    // only ever offer to turn the gate ON, in view, before Save.
    setHighEndTouched(v.llm_high_end === true)
    setLlmKeys({ openai: '', anthropic: '', gemini: '', mistral: '', compat: '' })
    setLlmKeySet({
      openai: !!v.llm_openai_api_key_set,
      anthropic: !!v.llm_anthropic_api_key_set,
      gemini: !!v.llm_gemini_api_key_set,
      mistral: !!v.llm_mistral_api_key_set,
      compat: !!v.llm_compat_api_key_set,
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
    u.llm_model = llmModel.trim()
    // Off means no assists at all, advanced included — don't persist a stale tick.
    u.llm_high_end = llmProvider !== 'off' && llmHighEnd
    switch (llmProvider) {
      case 'off': u.llm_provider = 'off'; break
      case 'ollama_docker': u.llm_provider = 'ollama'; u.llm_docker = true; break
      case 'ollama_remote':
        u.llm_provider = 'ollama'; u.llm_docker = false
        u.llm_ollama_url = llmOllamaUrl.trim()
        break
      case 'openai':
        u.llm_provider = 'openai'
        if (llmKeys.openai.trim()) u.llm_openai_api_key = llmKeys.openai.trim()
        break
      case 'anthropic':
        u.llm_provider = 'anthropic'
        if (llmKeys.anthropic.trim()) u.llm_anthropic_api_key = llmKeys.anthropic.trim()
        break
      case 'gemini':
        u.llm_provider = 'gemini'
        if (llmKeys.gemini.trim()) u.llm_gemini_api_key = llmKeys.gemini.trim()
        break
      case 'mistral':
        u.llm_provider = 'mistral'
        if (llmKeys.mistral.trim()) u.llm_mistral_api_key = llmKeys.mistral.trim()
        break
      case 'compat':
        u.llm_provider = 'compat'; u.llm_compat_url = llmCompatUrl.trim()
        if (llmKeys.compat.trim()) u.llm_compat_api_key = llmKeys.compat.trim()
        break
    }
    return u
  }, [provider, libreUrl, azureRegion, backupDir, keys, llmProvider, llmOllamaUrl, llmCompatUrl, llmModel, llmKeys,
      llmHighEnd, transLangs, primaryLocale, secondaryLocale])

  /**
   * Setting the model also SUGGESTS whether it's high-end, until the user
   * expresses an opinion — see `highEndTouched`. Wrapped here rather than in the
   * tab so the suggestion can't be bypassed by a second caller.
   */
  const onModelChange = useCallback((v: string) => {
    setLlmModel(v)
    if (!highEndTouched) setLlmHighEnd(looksHighEnd(v))
  }, [highEndTouched])

  const onHighEndChange = useCallback((v: boolean) => {
    setLlmHighEnd(v)
    setHighEndTouched(true)
  }, [])

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
      resetLlmAvailability()
      // Consent to send content to one provider is not consent to send it to
      // the next one — re-ask after any settings change.
      resetAssistConsent()
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
  const onTestLlm = useCallback(async () => {
    setLlmTest({ busy: true })
    const err = await doSave()
    if (err) { setLlmTest({ busy: false, ok: false, text: `Could not save: ${err}` }); return }
    const r = await api.testLlm(buildUpdate())
    setLlmTest({ busy: false, ok: r.reachable, text: r.message })
  }, [doSave, buildUpdate])

  const onOllamaDocker = useCallback(async (action: 'start' | 'stop' | 'status') => {
    setLlmDocker({ busy: true })
    const r = await api.ollamaDocker(action, llmModel.trim())
    const ok = r.ok ?? r.reachable ?? false
    setLlmDocker({ busy: false, ok, text: r.message })
  }, [llmModel])

  // The model picker only makes sense for Ollama — OpenAI/compat endpoints have
  // no list we can enumerate, so they keep the plain free-text field.
  const isOllama = llmProvider === 'ollama_docker' || llmProvider === 'ollama_remote'
  const modelOpts = useMemo(
    () => buildModelOptions(llmProvider, liveModels),
    [llmProvider, liveModels],
  )

  /**
   * Ask the provider what it currently offers. Sends the form's PENDING values
   * so a key you just pasted works before Save — otherwise the first refresh
   * after entering a key would always come back empty, which is precisely when
   * you want the list.
   */
  const refreshModels = useCallback(async () => {
    setModelsBusy(true)
    setLiveModels(await api.llmModels(buildUpdate()))
    setModelsBusy(false)
  }, [buildUpdate])

  // Populate when a provider that can be asked is showing, so the list is there
  // before the user opens it. Cheap, and silently empty if nothing answers.
  // Keyed on the provider only: re-running on every keystroke in the key field
  // would hammer the provider's API.
  useEffect(() => {
    if (llmProvider !== 'off') void refreshModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the provider only (see above), so typing a key does not hammer the provider API
  }, [llmProvider])

  const managed = status?.managed === true
  const keyPlaceholder = (set: boolean) => (set ? '•••••• (saved — leave blank to keep)' : 'API key')

  const form: SettingsForm = {
    status, managed, keyPlaceholder,
    provider, setProvider, libreUrl, setLibreUrl, azureRegion, setAzureRegion,
    keys, setKeys, keySet, docker, onDocker, test, onTest,
    transLangs, setTransLangs, forcedLangs,
    llmProvider, setLlmProvider, llmOllamaUrl, setLlmOllamaUrl,
    llmCompatUrl, setLlmCompatUrl, llmModel, setLlmModel: onModelChange,
    llmHighEnd, setLlmHighEnd: onHighEndChange,
    llmKeys, setLlmKeys, llmKeySet, llmTest, onTestLlm,
    llmDocker, onOllamaDocker, isOllama, modelOpts, modelsBusy, refreshModels,
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
