import { useEffect, useState, useCallback } from 'react'
import { useStore } from './store/useStore'
import { useResumePersistence } from './store/useResumePersistence'
import { ResumeList } from './components/ResumeList'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthGate } from './components/AuthGate'
import { AppHeader } from './components/AppHeader'
import { Sidebar } from './components/layout/Sidebar'
import { SECTIONS } from './lib/sections'
import { Overview } from './components/editor/Overview'
import { HeaderEditor } from './components/editor/HeaderEditor'
import { ProjectsEditor } from './components/editor/ProjectsEditor'
import {
  WorkEditor, EducationEditor, CoursesEditor, CertificationsEditor,
  PositionsEditor, PresentationsEditor, PublicationsEditor, AwardsEditor,
  SpokenLanguagesEditor, RecommendationsEditor,
} from './components/editor/SimpleEditors'
import { SkillsEditor, RolesEditor, ReferencesEditor, TechCategoriesEditor } from './components/editor/RegistryEditors'
import { ResumeViewsEditor } from './components/editor/ResumeViewsEditor'
import { ConflictModal } from './components/ConflictModal'
import { useRoute, navigate, Link } from './lib/router'
import { dropLegacyCache } from './lib/localCache'
import { api, setStoredToken, UnauthorizedError, clearStoredToken } from './lib/api'

// One-shot legacy-cache cleanup on first module load. The pre-multi-resume
// localStorage key holds data that can't safely be attributed to any one
// resume id now — drop it.
dropLegacyCache()

export default function App() {
  const route = useRoute()
  const [authNeeded, setAuthNeeded] = useState(false)
  // Bumped on a successful auth submission to remount the active route so it
  // re-fetches with the new token.
  const [authEpoch, setAuthEpoch] = useState(0)

  const onUnauthorized = useCallback(() => setAuthNeeded(true), [])

  const handleAuthSubmit = useCallback(async (token: string) => {
    setStoredToken(token)
    try {
      // Cheap probe — listResumes is the smallest auth-gated call we have.
      await api.listResumes()
      setAuthNeeded(false)
      setAuthEpoch((n) => n + 1)
    } catch (err) {
      if (err instanceof UnauthorizedError) clearStoredToken()
      throw err
    }
  }, [])

  if (authNeeded) {
    return <AuthGate onSubmit={handleAuthSubmit} />
  }

  if (route.name === 'editor') {
    return <EditorRoute key={`${route.id}:${authEpoch}`} resumeId={route.id} onUnauthorized={onUnauthorized} />
  }

  if (route.name === 'not-found') {
    return <NotFoundRoute path={route.path} />
  }

  return <ResumeList key={`picker:${authEpoch}`} onUnauthorized={onUnauthorized} />
}

// ── Editor route ─────────────────────────────────────────────────────────────

function EditorRoute({ resumeId, onUnauthorized }: { resumeId: string; onUnauthorized: () => void }) {
  const activeSection = useStore((s) => s.activeSection)
  const hasData = useStore((s) => s.hasData)
  const data = useStore((s) => s.data)
  const { loadState, saveState, cacheSavedAt, unsyncedCount, conflict, resolveConflict, retry } = useResumePersistence(resumeId)

  // The conflict modal can be dismissed (keep editing); the SaveStatus badge
  // re-opens it. A fresh conflict re-opens automatically.
  const [conflictDismissed, setConflictDismissed] = useState(false)
  useEffect(() => { if (conflict) setConflictDismissed(false) }, [conflict])

  // Bubble up auth state — the parent shows the modal.
  useEffect(() => {
    if (loadState === 'auth') onUnauthorized()
  }, [loadState, onUnauthorized])

  // No such resume → bounce to the picker.
  useEffect(() => {
    if (loadState === 'not-found') navigate('/', { replace: true })
  }, [loadState])

  if (loadState === 'loading' || loadState === 'not-found' || !hasData) {
    return (
      <div className="app-loading">
        <img src="/cartavio-logo.png" alt="Cartavio" className="app-loading-logo" />
        <p className="app-loading-text">Resume Studio — Connecting…</p>
        <style>{`
          .app-loading {
            min-height: 100vh; display: flex; flex-direction: column;
            align-items: center; justify-content: center; gap: 20px;
          }
          .app-loading-logo { width: 180px; height: auto; animation: pulse 2s ease-in-out infinite; }
          .app-loading-text { font-size: 13px; color: var(--ink-faint); letter-spacing: .02em; }
          @keyframes pulse { 0%,100% { opacity:.5 } 50% { opacity:1 } }
        `}</style>
      </div>
    )
  }

  // ── Main editor shell ────────────────────────────────────────────────────
  // 'key_qualifications' and 'key_competencies' fold into Personal Details
  // (sub-tabs), so the breadcrumb/title still reads "Personal Details" while
  // the section key may be one of those (Overview's missing-field deep link
  // uses 'key_qualifications').
  const sectionKeyForChrome =
    activeSection === 'key_qualifications' || activeSection === 'key_competencies'
      ? 'header'
      : activeSection
  const section = SECTIONS.find((s) => s.key === sectionKeyForChrome)

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <AppHeader
          resumeId={resumeId}
          section={section}
          saveState={saveState}
          cacheSavedAt={cacheSavedAt}
          unsyncedCount={unsyncedCount}
          onRetry={retry}
          onUnauthorized={onUnauthorized}
          onResolveConflict={() => setConflictDismissed(false)}
        />

        {conflict && !conflictDismissed && (
          <ConflictModal
            mine={data}
            theirs={conflict.data}
            onResolve={resolveConflict}
            onClose={() => setConflictDismissed(true)}
          />
        )}

        <div className={`app-content${activeSection === 'views' ? ' app-content-wide' : ''}`}>
          {/* Reset boundary on section change so a crashed view never traps the user. */}
          <ErrorBoundary resetKey={activeSection}>
            {activeSection === 'overview'              && <Overview />}
            {(activeSection === 'header' ||
              activeSection === 'key_qualifications' ||
              activeSection === 'key_competencies')    && <HeaderEditor />}
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
            {activeSection === 'recommendations'       && <RecommendationsEditor />}
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
        .app-content { padding: 28px 36px 80px; max-width: 1000px; width: 100%; }
        /* Resume Views uses the side-by-side preview — let it span the viewport. */
        .app-content-wide { max-width: none; }
      `}</style>
    </div>
  )
}

// ── 404 route ────────────────────────────────────────────────────────────────

function NotFoundRoute({ path }: { path: string }) {
  return (
    <div className="nf-screen">
      <h1>Page not found</h1>
      <p><code>{path}</code></p>
      <Link to="/" className="nf-back">← Back to your resumes</Link>
      <style>{`
        .nf-screen {
          min-height: 100vh; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 12px;
          color: var(--ink-soft); padding: 20px;
        }
        .nf-screen h1 { color: var(--accent); }
        .nf-back {
          margin-top: 8px; color: var(--accent); text-decoration: none; font-weight: 600;
        }
        .nf-back:hover { text-decoration: underline; }
      `}</style>
    </div>
  )
}
