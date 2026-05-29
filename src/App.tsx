import { useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore'
import { ImportScreen } from './components/ImportScreen'
import { Sidebar } from './components/layout/Sidebar'
import { LanguageSwitcher } from './components/layout/LanguageSwitcher'
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
import { Download, Upload, Check, Server } from 'lucide-react'
import { api, UnauthorizedError, setStoredToken, clearStoredToken, getStoredToken } from './lib/api'
import { downloadBackup, isBackupFormat, importFromBackup } from './lib/backup'

// ─── App-level load state ─────────────────────────────────────────────────────

type AppLoad = 'loading' | 'auth' | 'ready'

export default function App() {
  const { hasData, activeSection, data, loadStore, loadFromCVPartner } = useStore()

  const [loadState, setLoadState]   = useState<AppLoad>('loading')
  const [savedFlash, setSavedFlash] = useState(false)
  const [tokenInput, setTokenInput] = useState('')
  const [authError, setAuthError]   = useState('')

  // Prevent auto-save firing immediately on the initial server load
  const skipNextSave = useRef(true)
  const saveTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Initial load from server ───────────────────────────────────────────────
  useEffect(() => {
    api.load()
      .then((store) => {
        if (store) {
          skipNextSave.current = true
          loadStore(store)
        }
        setLoadState('ready')
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) {
          setLoadState('auth')
        } else {
          // Server unreachable or other network error — still show the app
          console.warn('Could not reach server:', err)
          setLoadState('ready')
        }
      })
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Auto-save: debounce 1 s after every data change ───────────────────────
  useEffect(() => {
    if (!hasData) return
    if (skipNextSave.current) { skipNextSave.current = false; return }

    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api.save(data)
        .then(() => {
          setSavedFlash(true)
          setTimeout(() => setSavedFlash(false), 2000)
        })
        .catch((err: unknown) => {
          if (err instanceof UnauthorizedError) setLoadState('auth')
          else console.error('Auto-save failed:', err)
        })
    }, 1000)

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  // data changes by reference on every mutation — correct dependency
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hasData])

  // ── Auth modal submit ──────────────────────────────────────────────────────
  const handleTokenSubmit = async () => {
    setAuthError('')
    setStoredToken(tokenInput)
    try {
      const store = await api.load()
      if (store) {
        skipNextSave.current = true
        loadStore(store)
      }
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

      const isBackup = (
        json !== null &&
        typeof json === 'object' &&
        (json as Record<string, unknown>)['$schema'] === 'resumestudio/v1'
      )

      if (isBackup) {
        if (isBackupFormat(json)) {
          skipNextSave.current = false
          loadStore(importFromBackup(json))
        }
      } else {
        skipNextSave.current = false
        loadFromCVPartner(json as Record<string, unknown>)
      }
    } catch (e) {
      alert(`Could not load file: ${(e as Error).message}`)
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
            {savedFlash && (
              <span className="ah-saved"><Check size={13} /> Saved</span>
            )}
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
        .ah-saved {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 12px; font-weight: 600; color: #27ae60;
          animation: fadeIn .2s ease;
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: none } }
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
