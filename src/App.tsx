import { Server } from 'lucide-react'
import { useStore } from './store/useStore'
import { useResumePersistence } from './store/useResumePersistence'
import { ImportScreen } from './components/ImportScreen'
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
  SpokenLanguagesEditor, ProfileEditor,
} from './components/editor/SimpleEditors'
import { SkillsEditor, RolesEditor, ReferencesEditor, TechCategoriesEditor } from './components/editor/RegistryEditors'
import { ResumeViewsEditor } from './components/editor/ResumeViewsEditor'

export default function App() {
  const hasData = useStore((s) => s.hasData)
  const activeSection = useStore((s) => s.activeSection)
  const { loadState, saveState, cacheSavedAt, retry, submitToken, loadFile } = useResumePersistence()

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
  if (loadState === 'auth') return <AuthGate onSubmit={submitToken} />

  // ── No data yet — show import screen ──────────────────────────────────────
  if (!hasData) return <ImportScreen />

  // ── Main editor shell ──────────────────────────────────────────────────────
  const section = SECTIONS.find((s) => s.key === activeSection)

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <AppHeader
          section={section}
          saveState={saveState}
          cacheSavedAt={cacheSavedAt}
          onRetry={retry}
          onLoadFile={loadFile}
        />

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
        .app-content { padding: 28px 36px 80px; max-width: 1000px; width: 100%; }
      `}</style>
    </div>
  )
}
