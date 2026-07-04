import { useEffect, useState, useCallback } from 'react'
import { useStore } from './store/useStore'
import { useResumePersistence } from './store/useResumePersistence'
import { ResumeList } from './components/ResumeList'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthGate } from './components/AuthGate'
import { AppHeader } from './components/AppHeader'
import { Sidebar } from './components/layout/Sidebar'
import { SECTIONS, canonicalSectionKey } from './lib/sections'
import { Overview } from './components/editor/Overview'
import { HeaderEditor } from './components/editor/HeaderEditor'
import { ProfileCompetenciesEditor } from './components/editor/ProfileCompetenciesEditor'
import { ProjectsEditor } from './components/editor/ProjectsEditor'
import {
  WorkEditor, EducationEditor, CoursesEditor, CertificationsEditor,
  PositionsEditor, PresentationsEditor, PublicationsEditor, AwardsEditor,
  SpokenLanguagesEditor, RecommendationsEditor,
} from './components/editor/SimpleEditors'
import { SkillsEditor, RolesEditor, IndustriesEditor, ReferencesEditor } from './components/editor/RegistryEditors'
import { ResumeViewsEditor } from './components/editor/ResumeViewsEditor'
import { ConflictModal } from './components/ConflictModal'
import { NewerDataNotice } from './components/NewerDataNotice'
import { useRoute, navigate, Link } from './lib/router'
import { dropLegacyCache } from './lib/localCache'
import { api } from './lib/api'

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
    // Exchange the token for an HttpOnly session cookie (throws
    // UnauthorizedError on a wrong token — no cookie is set), then verify with
    // the smallest auth-gated call we have.
    await api.login(token)
    await api.listResumes()
    setAuthNeeded(false)
    setAuthEpoch((n) => n + 1)
  }, [])

  if (authNeeded) {
    return <AuthGate onSubmit={handleAuthSubmit} />
  }

  if (route.name === 'editor') {
    return (
      <EditorRoute
        key={`${route.id}:${authEpoch}`}
        resumeId={route.id}
        routeSection={route.section}
        routeViewId={route.viewId}
        onUnauthorized={onUnauthorized}
      />
    )
  }

  if (route.name === 'not-found') {
    return <NotFoundRoute path={route.path} />
  }

  return <ResumeList key={`picker:${authEpoch}`} onUnauthorized={onUnauthorized} />
}

// ── Editor route ─────────────────────────────────────────────────────────────

function EditorRoute({ resumeId, routeSection, routeViewId, onUnauthorized }: {
  resumeId: string
  routeSection?: string
  routeViewId?: string
  onUnauthorized: () => void
}) {
  const activeSection = useStore((s) => s.activeSection)
  const activeViewId = useStore((s) => s.activeViewId)
  const hasData = useStore((s) => s.hasData)
  const data = useStore((s) => s.data)
  const { loadState, saveState, cacheSavedAt, unsyncedCount, conflict, resolveConflict, retry } = useResumePersistence(resumeId)

  // ── URL ⇄ section sync ───────────────────────────────────────────────────
  // The URL is canonical (/r/:id[/:section | /views/:viewId]) so a refresh
  // keeps your place, sections are bookmarkable, and the browser Back button
  // walks section history instead of leaving the editor.
  //
  // Effect ORDER is load-bearing: URL→store runs first and updates Zustand
  // synchronously, so the store→URL effect (which reads fresh state via
  // getState) never pushes a stale path in the same commit — including right
  // after boot, when loadStore has reset activeViewId.
  useEffect(() => {
    if (!hasData) return // reconcile once the resume is in memory
    const st = useStore.getState()
    const section = routeSection ?? 'overview'
    if (!SECTIONS.some((s) => s.key === section)) {
      navigate({ name: 'editor', id: resumeId }, { replace: true })
      return
    }
    if (section === 'views') {
      // An unknown view id (deleted elsewhere, mistyped link) falls back to
      // the view list rather than rendering a broken editor.
      if (routeViewId && !st.data.views.some((v) => v.id === routeViewId)) {
        navigate({ name: 'editor', id: resumeId, section: 'views' }, { replace: true })
        return
      }
      if (st.activeSection !== 'views' || st.activeViewId !== (routeViewId ?? null)) {
        st.setActiveView(routeViewId ?? null)
      }
    } else if (st.activeSection !== section) {
      st.setActiveSection(section)
    }
  }, [hasData, resumeId, routeSection, routeViewId])

  useEffect(() => {
    const st = useStore.getState()
    if (!st.hasData) return
    navigate({
      name: 'editor',
      id: resumeId,
      section: st.activeSection,
      viewId: st.activeSection === 'views' ? (st.activeViewId ?? undefined) : undefined,
    })
  }, [activeSection, activeViewId, hasData, resumeId])

  // The conflict modal can be dismissed (keep editing); the SaveStatus badge
  // re-opens it. A fresh conflict re-opens automatically.
  const [conflictDismissed, setConflictDismissed] = useState(false)
  useEffect(() => { if (conflict) setConflictDismissed(false) }, [conflict])

  // Sidebar drawer open state for narrow viewports. The Sidebar itself uses
  // CSS to decide whether to render as inline or as a drawer; this state only
  // matters when the breakpoint is active. Closes automatically when the user
  // picks a new section (Sidebar fires onClose for us).
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Auto-close if the viewport grows past the drawer breakpoint while the
  // drawer was open — otherwise the backdrop's display:none would be hiding
  // it but the React state would still say "open", which surfaces as a stuck
  // `is-open` class. Cheap MQ subscription, no resize-throttle needed.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(min-width: 881px)')
    const onChange = (e: MediaQueryListEvent) => { if (e.matches) setSidebarOpen(false) }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  // Switching sections from elsewhere (e.g. Overview deep link) should also
  // dismiss the drawer so the user lands on the new section without it.
  useEffect(() => { setSidebarOpen(false) }, [activeSection])

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
  // 'key_qualifications' and 'key_competencies' are edited on the combined
  // "Profile & Competencies" page, so the breadcrumb/title shows that page
  // while the section key may be a content key (Overview's missing-field
  // deep link uses 'key_qualifications').
  const section = SECTIONS.find((s) => s.key === canonicalSectionKey(activeSection))

  return (
    <div className="app-shell">
      {/* First Tab stop: skip the ~25 sidebar items straight to the editor
          pane (WCAG 2.4.1). Visible only while focused — see index.css. */}
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
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
          onOpenSidebar={() => setSidebarOpen(true)}
        />

        <NewerDataNotice />

        {conflict && !conflictDismissed && (
          <ConflictModal
            mine={data}
            theirs={conflict.data}
            onResolve={resolveConflict}
            onClose={() => setConflictDismissed(true)}
          />
        )}

        <div id="main-content" tabIndex={-1} className={`app-content${activeSection === 'views' ? ' app-content-wide' : ''}`}>
          {/* Reset boundary on section change so a crashed view never traps the user. */}
          <ErrorBoundary resetKey={activeSection}>
            {activeSection === 'overview'              && <Overview />}
            {activeSection === 'header'                && <HeaderEditor />}
            {(activeSection === 'profile_competencies' ||
              activeSection === 'key_qualifications' ||
              activeSection === 'key_competencies')    && <ProfileCompetenciesEditor />}
            {activeSection === 'projects'              && <ProjectsEditor />}
            {activeSection === 'work_experiences'      && <WorkEditor />}
            {activeSection === 'positions'             && <PositionsEditor />}
            {activeSection === 'educations'            && <EducationEditor />}
            {activeSection === 'courses'               && <CoursesEditor />}
            {activeSection === 'certifications'        && <CertificationsEditor />}
            {activeSection === 'spoken_languages'      && <SpokenLanguagesEditor />}
            {activeSection === 'presentations'         && <PresentationsEditor />}
            {activeSection === 'publications'          && <PublicationsEditor />}
            {activeSection === 'honor_awards'          && <AwardsEditor />}
            {activeSection === 'recommendations'       && <RecommendationsEditor />}
            {activeSection === 'references'            && <ReferencesEditor />}
            {/* The Skills Showcase (old deep link / Overview stat) is now edited
                on the Skill Registry page — a category + highlight is all it
                takes to appear there. See canonicalSectionKey(). */}
            {(activeSection === 'skills' ||
              activeSection === 'technology_categories') && <SkillsEditor />}
            {activeSection === 'roles'                 && <RolesEditor />}
            {activeSection === 'industries'            && <IndustriesEditor />}
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
        /* Narrow viewports: pull the content padding in so editor cards have
           room to breathe once the sidebar has folded into a drawer. */
        @media (max-width: 880px) {
          .app-content { padding: 20px 16px 60px; }
        }
        @media (max-width: 560px) {
          .app-content { padding: 16px 12px 48px; }
        }
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
