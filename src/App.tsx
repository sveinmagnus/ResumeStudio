import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore'
import { useUndoRedo } from './store/useUndoRedo'
import { ImportScreen } from './components/ImportScreen'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Sidebar } from './components/layout/Sidebar'
import { LanguageSwitcher } from './components/layout/LanguageSwitcher'
import { SaveStatus, type SaveState } from './components/layout/SaveStatus'
import { SECTIONS } from './lib/sections'
import { Overview } from './components/editor/Overview'
import { HeaderEditor } from './components/editor/HeaderEditor'
import { ProjectsEditor } from './components/editor/ProjectsEditor'
import {
  WorkEditor, EducationEditor, CoursesEditor, CertificationsEditor,
  PositionsEditor, PresentationsEditor, PublicationsEditor, AwardsEditor,
  SpokenLanguagesEditor, ProfileEditor,
} from './components/editor/SimpleEditors'
import { SkillsEditor, RolesEditor, ReferencesEditor, TechCategoriesEditor } from './components/editor/RegistryEditors'
import { ResumeViewsEditor } from './components/editor/ResumeViewsEditor'
import { Download, Upload, Server, Undo2, Redo2 } from 'lucide-react'
import { api, UnauthorizedError, isAbortError, setStoredToken, clearStoredToken, getStoredToken } from './lib/api'
import {
  downloadBackup, isBackupFormat, importFromBackup,
  UnsupportedBackupVersionError,
} from './lib/backup'
import { loadCache, saveCache, clearCache } from './lib/localCache'

// ─── App-level load state ─────────────────────────────────────────────────────

type AppLoad = 'loading' | 'auth' | 'ready'

export default function App() {
  const { hasData, activeSection, data, mutationCount, loadStore, loadFromCVPartner } = useStore()
  const { undo, redo, canUndo, canRedo } = useUndoRedo()

  const [loadState, setLoadState]   = useState<AppLoad>('loading')
  const [saveState, setSaveState]   = useState<SaveState>('idle')
  const [cacheSavedAt, setCacheSavedAt] = useState<string | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [authError, setAuthError]   = useState('')

  // ── Auto-save plumbing ────────────────────────────────────────────────────
  // mutationCount is "have we changed anything since the last successful
  // server save?" Loads reset it to 0 in the store. Both `data` and
  // `mutationCount` change together on a mutation, so we depend on
  // `mutationCount` only and read `data` via `useStore.getState()` — keeps
  // `flushToServer` from being rebuilt on every keystroke (which would
  // otherwise churn the save-effect teardown/setup cycle).
  const lastSavedMutation = useRef(0)
  const saveAbort         = useRef<AbortController | null>(null)

  // Push current data to the server. The Retry button reuses this entry.
  const flushToServer = useCallback(async () => {
    const snapshot = useStore.getState().data
    const counterAtSend = useStore.getState().mutationCount
    saveAbort.current?.abort()
    saveAbort.current = new AbortController()
    setSaveState('saving')
    try {
      await api.save(snapshot, saveAbort.current.signal)
      lastSavedMutation.current = counterAtSend
      setSaveState('saved')
      // Clear the local cache once it matches the server — keeps things tidy
      // and avoids stale data lingering after a successful sync.
      clearCache()
      setCacheSavedAt(null)
      setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2000)
    } catch (err) {
      if (isAbortError(err)) return
      if (err instanceof UnauthorizedError) { setLoadState('auth'); return }
      console.error('Auto-save failed:', err)
      setSaveState('error')
    }
  }, [])

  // ── Initial load: prefer server, fall back to local cache ─────────────────
  useEffect(() => {
    api.load()
      .then((store) => {
        if (store) {
          loadStore(store)
          // Server is the source of truth — drop any local cache.
          clearCache()
          setCacheSavedAt(null)
        } else {
          // Server is up but has no resume yet. If we have local work,
          // restore it silently so the user doesn't lose anything.
          const cached = loadCache()
          if (cached) {
            loadStore(cached.data)
            setCacheSavedAt(cached.saved_at)
          }
        }
        setLoadState('ready')
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) { setLoadState('auth'); return }
        // Server unreachable — try the local cache so the user can keep working.
        console.warn('Could not reach server:', err)
        const cached = loadCache()
        if (cached) {
          loadStore(cached.data)
          setCacheSavedAt(cached.saved_at)
          setSaveState('offline')
        }
        setLoadState('ready')
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Local-cache write: short debounce so we don't stringify the whole
  //    store on every keystroke. Still much tighter than the server save
  //    (1 s) so a browser crash loses at most ~quarter-second of work.
  useEffect(() => {
    if (!hasData || mutationCount === 0) return
    const t = setTimeout(() => {
      saveCache(useStore.getState().data)
      setCacheSavedAt(new Date().toISOString())
    }, 250)
    return () => clearTimeout(t)
  }, [mutationCount, hasData])

  // ── Server save: 1s debounce after the latest user mutation ───────────────
  useEffect(() => {
    if (!hasData) return
    if (mutationCount === lastSavedMutation.current) return
    const t = setTimeout(() => { void flushToServer() }, 1000)
    return () => clearTimeout(t)
  }, [mutationCount, hasData, flushToServer])

  // ── Auth modal submit ──────────────────────────────────────────────────────
  const handleTokenSubmit = async () => {
    setAuthError('')
    setStoredToken(tokenInput)
    try {
      const store = await api.load()
      if (store) loadStore(store)
      setLoadState('ready')
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        clearStoredToken()
        setAuthError('Token is incorrect. Please try again.')
      } else {
        setAuthError('Could not connect to server.')
      }
    }
  }

  // ── File load handler (Load file button in header) ─────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleLoadFile = async (file: File) => {
    try {
      const text = await file.text()
      const json = JSON.parse(text) as unknown

      if (isBackupFormat(json)) {
        // Routes through migrateBackup → throws UnsupportedBackupVersionError
        // if the file was saved by a newer build.
        loadStore(importFromBackup(json))
      } else {
        // Anything else we assume is a CVpartner export — the importer is
        // defensive enough to handle most malformed inputs.
        loadFromCVPartner(json as Record<string, unknown>)
      }
    } catch (e) {
      const msg = e instanceof UnsupportedBackupVersionError
        ? e.message
        : `Could not load file: ${(e as Error).message}`
      alert(msg)
    }
  }

  // ── Loading splash ─────────────────────────────────────────────────────────
  if (loadState === 'loading') {
    return (
      <div className="app-loading">
        <Server size={32} className="app-loading-icon" />
        <p>Connecting to server…</p>
        <style>{`
          .app-loading {
            min-height: 100vh; display: flex; flex-direction: column;
            align-items: center; justify-content: center; gap: 16px;
            color: var(--ink-soft); font-size: 14px;
          }
          .app-loading-icon { color: var(--accent); animation: pulse 1.5s ease-in-out infinite; }
          @keyframes pulse { 0%,100% { opacity:.4 } 50% { opacity:1 } }
        `}</style>
      </div>
    )
  }

  // ── Auth modal ─────────────────────────────────────────────────────────────
  if (loadState === 'auth') {
    return (
      <div className="auth-overlay">
        <div className="auth-card">
          <div className="auth-icon"><Server size={28} /></div>
          <h2 className="auth-title">API Token Required</h2>
          <p className="auth-desc">
            This Resume Studio server is protected. Enter your API token to continue.
          </p>
          <input
            className="auth-input"
            type="password"
            placeholder="Paste token here…"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleTokenSubmit() }}
            autoFocus
          />
          {authError && <div className="auth-error">{authError}</div>}
          <button
            className="auth-submit"
            onClick={() => void handleTokenSubmit()}
            disabled={!tokenInput.trim()}
          >
            Connect
          </button>
          {getStoredToken() && (
            <button className="auth-clear" onClick={() => { clearStoredToken(); setTokenInput('') }}>
              Clear saved token
            </button>
          )}
        </div>

        <style>{`
          .auth-overlay { min-height: 100vh; display: grid; place-items: center; padding: 40px; }
          .auth-card {
            max-width: 420px; width: 100%; text-align: center;
            background: var(--paper-raised); border: 1px solid var(--line);
            border-radius: var(--r-lg); padding: 40px 36px; box-shadow: var(--shadow-lg);
          }
          .auth-icon {
            width: 60px; height: 60px; margin: 0 auto 20px; border-radius: 50%;
            background: var(--accent-wash); color: var(--accent); display: grid; place-items: center;
          }
          .auth-title { font-size: 22px; margin-bottom: 10px; }
          .auth-desc  { color: var(--ink-soft); font-size: 14px; line-height: 1.6; margin-bottom: 24px; }
          .auth-input {
            width: 100%; padding: 10px 14px; border: 1.5px solid var(--line-strong);
            border-radius: var(--r-md); font-size: 14px; margin-bottom: 10px;
            background: var(--paper-sunken); color: var(--ink);
          }
          .auth-input:focus { outline: none; border-color: var(--accent); }
          .auth-error {
            font-size: 13px; color: #c0392b; background: #fdf0ef;
            padding: 8px 12px; border-radius: var(--r-sm); margin-bottom: 10px;
          }
          .auth-submit {
            width: 100%; padding: 11px; background: var(--accent); color: #fff;
            border-radius: var(--r-md); font-weight: 600; font-size: 15px;
            transition: opacity .15s; margin-bottom: 10px;
          }
          .auth-submit:disabled { opacity: .4; cursor: not-allowed; }
          .auth-submit:not(:disabled):hover { opacity: .88; }
          .auth-clear { font-size: 12px; color: var(--ink-faint); text-decoration: underline; }
        `}</style>
      </div>
    )
  }

  // ── No data yet — show import screen ──────────────────────────────────────
  if (!hasData) return <ImportScreen />

  // ── Main editor shell ──────────────────────────────────────────────────────
  const section = SECTIONS.find((s) => s.key === activeSection)

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <header className="app-header">
          <div className="ah-titles">
            <div className="ah-crumb">{section?.group}</div>
            <h1 className="ah-title">{section?.label}</h1>
          </div>
          <div className="ah-controls">
            <SaveStatus
              state={saveState}
              cacheSavedAt={cacheSavedAt}
              onRetry={() => { void flushToServer() }}
            />
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

            {/* Load file — accepts backup JSON or CVpartner JSON */}
            <button
              className="ah-btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              title="Load a backup file or CVpartner export"
            >
              <Upload size={15} /> Load file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleLoadFile(f)
                // Reset so same file can be reloaded
                e.target.value = ''
              }}
            />

            {/* Save to file — downloads backup JSON */}
            <button
              className="ah-export"
              onClick={() => downloadBackup(data)}
              title="Download a portable backup of your resume"
            >
              <Download size={16} /> Save to file
            </button>
          </div>
        </header>

        <div className="app-content">
          {/* Reset boundary on section change so a crashed view never traps the user. */}
          <ErrorBoundary resetKey={activeSection}>
            {activeSection === 'overview'              && <Overview />}
            {activeSection === 'header'                && <HeaderEditor />}
            {activeSection === 'key_qualifications'    && <ProfileEditor />}
            {activeSection === 'projects'              && <ProjectsEditor />}
            {activeSection === 'work_experiences'      && <WorkEditor />}
            {activeSection === 'positions'             && <PositionsEditor />}
            {activeSection === 'educations'            && <EducationEditor />}
            {activeSection === 'courses'               && <CoursesEditor />}
            {activeSection === 'certifications'        && <CertificationsEditor />}
            {activeSection === 'technology_categories' && <TechCategoriesEditor />}
            {activeSection === 'spoken_languages'      && <SpokenLanguagesEditor />}
            {activeSection === 'presentations'         && <PresentationsEditor />}
            {activeSection === 'publications'          && <PublicationsEditor />}
            {activeSection === 'honor_awards'          && <AwardsEditor />}
            {activeSection === 'references'            && <ReferencesEditor />}
            {activeSection === 'skills'                && <SkillsEditor />}
            {activeSection === 'roles'                 && <RolesEditor />}
            {activeSection === 'views'                 && <ResumeViewsEditor />}
          </ErrorBoundary>
        </div>
      </main>

      <style>{`
        .app-shell { display: flex; min-height: 100vh; position: relative; z-index: 1; }
        .app-main  { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .app-header {
          display: flex; align-items: flex-end; justify-content: space-between; gap: 20px;
          padding: 22px 36px 18px; border-bottom: 1px solid var(--line);
          position: sticky; top: 0; background: var(--paper); z-index: 10; flex-wrap: wrap;
        }
        .ah-crumb { font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); }
        .ah-title { font-size: 30px; margin-top: 2px; }
        .ah-controls { display: flex; align-items: center; gap: 10px; }
        .ah-history {
          display: inline-flex; align-items: stretch; gap: 1px;
          background: var(--paper-raised); border: 1px solid var(--line);
          border-radius: var(--r-sm); overflow: hidden;
        }
        .ah-hist-btn {
          width: 30px; height: 32px; display: grid; place-items: center;
          color: var(--ink-soft); transition: all .13s;
        }
        .ah-hist-btn:hover:not(:disabled) { background: var(--accent-wash); color: var(--accent); }
        .ah-hist-btn:disabled { opacity: .3; cursor: default; }
        .ah-btn-secondary {
          display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px;
          border: 1.5px solid var(--line-strong); border-radius: var(--r-md);
          font-weight: 600; font-size: 13px; color: var(--ink-soft); transition: all .15s;
        }
        .ah-btn-secondary:hover { border-color: var(--accent); color: var(--accent); }
        .ah-export {
          display: inline-flex; align-items: center; gap: 7px; padding: 11px 18px;
          background: var(--ink); color: var(--paper); border-radius: var(--r-md);
          font-weight: 600; font-size: 14px; transition: all .15s; align-self: stretch;
        }
        .ah-export:hover { background: var(--accent); }
        .app-content { padding: 28px 36px 80px; max-width: 1000px; width: 100%; }
      `}</style>
    </div>
  )
}
