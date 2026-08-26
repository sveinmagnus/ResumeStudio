import { useEffect, useState, useCallback, lazy, Suspense, type ReactNode } from 'react'
import { useStore } from './store/useStore'
import { useResumePersistence } from './store/useResumePersistence'
import { useCanonicalRegistrySync } from './store/useCanonicalRegistrySync'
import { ResumeList } from './components/ResumeList'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthGate } from './components/AuthGate'
import { AppHeader } from './components/AppHeader'
import { Sidebar } from './components/layout/Sidebar'
import { AdvisorToast } from './components/ui/AdvisorToast'
import { SECTIONS, canonicalSectionKey } from './lib/sections'
import { Overview } from './components/editor/Overview'
import { HeaderEditor } from './components/editor/HeaderEditor'
import { ProjectsEditor } from './components/editor/ProjectsEditor'
import {
  WorkEditor, EducationEditor, CoursesEditor, CertificationsEditor,
  PositionsEditor, PresentationsEditor, PublicationsEditor, AwardsEditor,
  SpokenLanguagesEditor, RecommendationsEditor, ProfileEditor, KeyCompetenciesEditor,
} from './components/editor/SimpleEditors'
import { SkillsEditor, RolesEditor, IndustriesEditor, ReferencesEditor } from './components/editor/RegistryEditors'
import { ResumeViewsEditor } from './components/editor/ResumeViewsEditor'
import { CoverLettersEditor } from './components/editor/CoverLettersEditor'
import { ConflictModal } from './components/ConflictModal'
import { NewerDataNotice } from './components/NewerDataNotice'
import { ReadOnlyNotice } from './components/ReadOnlyNotice'
import { RemoteUpdateNotice } from './components/RemoteUpdateNotice'
import { RegistryConflictNotice } from './components/RegistryConflictNotice'
// The account screens are lazy for the same reason the exporters are: they are
// four rarely-visited routes, and the initial payload is a budget CI enforces.
// `.then(m => ({ default: … }))` keeps the named exports the house style wants.
const PublicAccountScreen = lazy(() =>
  import('./components/account/AccountScreens').then((m) => ({ default: m.PublicAccountScreen })))
const ProfileScreen = lazy(() =>
  import('./components/account/ProfileScreen').then((m) => ({ default: m.ProfileScreen })))
const TeamScreen = lazy(() =>
  import('./components/account/TeamScreen').then((m) => ({ default: m.TeamScreen })))
import {
  useRoute, navigate, Link, stampHistoryState, takePendingRestore, isPublicAccountScreen,
  parseRoute, pathFor,
  type AccountScreen,
} from './lib/router'
import { resolveSegment, preferredSegment, isSlugSegment, type SlugCandidate } from './lib/resumeSlug'
import { dropLegacyCache, listCached } from './lib/localCache'
import { api, forgetIdentity, UnauthorizedError, type MeInfo } from './lib/api'

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

  /**
   * A session now exists. Drop the gate and remount the active route so every
   * fetch runs again with the new cookie; forget the memoized identity so the
   * read-only decision is made against the account that just signed in.
   */
  const onAuthenticated = useCallback(() => {
    forgetIdentity()
    setAuthNeeded(false)
    setAuthEpoch((n) => n + 1)
  }, [])

  // The five signed-out account screens render BEFORE the gate is consulted.
  // Everyone who reaches a reset link, an invitation or a verification link is
  // by definition somebody the gate would otherwise swallow, and dropping them
  // on a sign-in form is exactly the dead end those links exist to open.
  if (route.name === 'account' && isPublicAccountScreen(route.screen)) {
    return (
      <AccountChunk>
        <PublicAccountScreen screen={route.screen} onSignedIn={onAuthenticated} />
      </AccountChunk>
    )
  }

  if (authNeeded) {
    return <AuthGate onAuthenticated={onAuthenticated} />
  }

  if (route.name === 'account') {
    return (
      <SignedInAccountRoute
        key={`account:${authEpoch}`}
        screen={route.screen}
        onUnauthorized={onUnauthorized}
      />
    )
  }

  if (route.name === 'editor') {
    // NOT keyed on route.id: the segment changes spelling (uuid ↔ the readable
    // address) without changing which resume is open, and a remount on that
    // would reload the editor mid-rewrite. The resolver keys EditorRoute on
    // the RESOLVED id instead.
    return (
      <EditorResolver
        key={`editor:${authEpoch}`}
        segment={route.id}
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

// ── Signed-in account routes (/profile, /admin) ──────────────────────────────

/**
 * Resolves the identity first, because both screens below need it: the team
 * page marks your own row, and neither has anything to show a SERVICE
 * credential — a shared token authenticates but is nobody, so there is no
 * profile behind it to edit.
 */
function SignedInAccountRoute({ screen, onUnauthorized }: {
  screen: AccountScreen
  onUnauthorized: () => void
}) {
  const [me, setMe] = useState<MeInfo | null>(null)
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api.me().then((m) => {
      if (cancelled) return
      setMe(m)
      setResolved(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (resolved && !me) onUnauthorized()
  }, [resolved, me, onUnauthorized])

  if (!resolved) return <AccountLoading />
  if (!me || me.service) return <NotFoundRoute path={`/${screen}`} />
  if (screen === 'admin' && me.role !== 'owner') return <NotFoundRoute path="/admin" />

  return (
    <AccountChunk>
      {screen === 'admin'
        ? <TeamScreen meId={me.user_id} />
        : <ProfileScreen onSignedOut={onUnauthorized} />}
    </AccountChunk>
  )
}

function AccountLoading() {
  return (
    <p role="status" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ink-faint)' }}>
      Loading…
    </p>
  )
}

function AccountChunk({ children }: { children: ReactNode }) {
  return <Suspense fallback={<AccountLoading />}>{children}</Suspense>
}

// ── Editor route ─────────────────────────────────────────────────────────────

/**
 * Turn the URL's id segment into (resumeId, urlId) before the editor mounts.
 *
 * The segment is either the UUID or the resume's readable address derived from
 * the person's email (`lib/resumeSlug.ts`). A UUID passes straight through and
 * starts loading immediately; a slug has to be resolved against the resume
 * list first — and the list is fetched either way, because choosing the
 * PREFERRED spelling (short slug / full slug / id) needs the other resumes'
 * emails to check for collisions. Offline, the local cache stands in for the
 * list, so a bookmarked readable address still opens the cached copy.
 *
 * `urlId` is what every URL write inside the editor spells the resume as; the
 * UUID remains a valid address forever (bookmarks, exports), it just gets
 * rewritten to the readable form once the list confirms one.
 */
function EditorResolver({ segment, routeSection, routeViewId, onUnauthorized }: {
  segment: string
  routeSection?: string
  routeViewId?: string
  onUnauthorized: () => void
}) {
  const [list, setList] = useState<SlugCandidate[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api.listResumes()
      .then((rows) => {
        if (cancelled) return
        setList(rows.map((r) => ({ id: r.id, email: r.email ?? null })))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof UnauthorizedError) { onUnauthorized(); return }
        // Offline / server down: the per-id cache knows enough to resolve.
        setList(listCached().map((c) => ({ id: c.id, email: c.email })))
      })
    return () => { cancelled = true }
  }, [onUnauthorized])

  // A slug-shaped segment needs the list; anything else IS the id (an unknown
  // one bounces via the persistence layer's 404, exactly as before).
  const resumeId = isSlugSegment(segment) && list
    ? resolveSegment(list, segment)
    : isSlugSegment(segment) ? null : segment

  // A readable address that matches nothing (or, after a collision appeared,
  // more than one thing) is an unknown address — the picker, not a guess.
  useEffect(() => {
    if (list && isSlugSegment(segment) && !resolveSegment(list, segment)) {
      navigate('/', { replace: true })
    }
  }, [list, segment])

  if (!resumeId) return <BootScreen />

  return (
    <EditorRoute
      key={resumeId}
      resumeId={resumeId}
      urlId={list ? preferredSegment(list, resumeId) : segment}
      routeSection={routeSection}
      routeViewId={routeViewId}
      onUnauthorized={onUnauthorized}
    />
  )
}

function EditorRoute({ resumeId, urlId, routeSection, routeViewId, onUnauthorized }: {
  resumeId: string
  /** How URL writes spell this resume: its readable address, or the id. */
  urlId: string
  routeSection?: string
  routeViewId?: string
  onUnauthorized: () => void
}) {
  const activeSection = useStore((s) => s.activeSection)
  const activeViewId = useStore((s) => s.activeViewId)
  const hasData = useStore((s) => s.hasData)
  const data = useStore((s) => s.data)
  const readOnly = useStore((s) => s.readOnly)
  const { loadState, saveState, cacheSavedAt, unsyncedCount, conflict, resolveConflict, retry, remoteUpdate, reloadFromServer } = useResumePersistence(resumeId)
  // Propagate a rename of a SHARED registry entry to the instance registry so
  // other resumes pick it up on load (no-op unless entries are linked).
  useCanonicalRegistrySync()

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
    // Nothing to reconcile against until the resume is in memory.
    if (!hasData) return
    const st = useStore.getState()
    // Canonicalize first so legacy/alias keys (e.g. the old combined
    // 'profile_competencies') resolve to a real section instead of bouncing to
    // the default. The store→URL effect then rewrites the URL to the canonical
    // key, so the address bar self-heals.
    const section = canonicalSectionKey(routeSection ?? 'overview')
    if (!SECTIONS.some((s) => s.key === section)) {
      navigate({ name: 'editor', id: urlId }, { replace: true })
      return
    }
    if (section === 'views') {
      // An unknown view id (deleted elsewhere, mistyped link) falls back to
      // the view list rather than rendering a broken editor.
      if (routeViewId && !st.data.views.some((v) => v.id === routeViewId)) {
        navigate({ name: 'editor', id: urlId, section: 'views' }, { replace: true })
        return
      }
      if (st.activeSection !== 'views' || st.activeViewId !== (routeViewId ?? null)) {
        st.setActiveView(routeViewId ?? null)
      }
    } else if (st.activeSection !== section) {
      st.setActiveSection(section)
    }

    // Back/forward only: put the user where they were. This runs AFTER the
    // section switch on purpose — `setActiveSection` clears `expandedItemId`,
    // so reopening the card has to come second or it would be undone.
    const restore = takePendingRestore()
    if (!restore) return
    if (restore.expandedItemId) useStore.getState().openItem(restore.expandedItemId)
    // Two frames: one for React to commit the new section, one for the browser
    // to lay it out. Scrolling before the content exists scrolls nothing.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo({ top: restore.scrollY, behavior: 'auto' })
    }))
  }, [hasData, urlId, routeSection, routeViewId])

  /**
   * Keep the current history entry's snapshot fresh as the user scrolls and
   * opens cards, so Back has something to restore. Stamping at navigation time
   * doesn't work: the section switch clears the expanded card first.
   */
  useEffect(() => {
    let frame = 0
    const stamp = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => stampHistoryState({
        scrollY: window.scrollY,
        expandedItemId: useStore.getState().expandedItemId,
      }))
    }
    stamp()
    window.addEventListener('scroll', stamp, { passive: true })
    const unsub = useStore.subscribe(stamp)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', stamp)
      unsub()
    }
  }, [])

  useEffect(() => {
    const st = useStore.getState()
    if (!st.hasData) return
    const target = {
      name: 'editor' as const,
      id: urlId,
      section: st.activeSection,
      viewId: st.activeSection === 'views' ? (st.activeViewId ?? undefined) : undefined,
    }
    // When only the ID SEGMENT changes spelling (the uuid becoming the
    // readable address once the list confirms it), rewrite in place — Back
    // must never step through spellings of the same location.
    const cur = parseRoute(window.location.pathname)
    const sameSpot = cur.name === 'editor' && pathFor({ ...cur, id: urlId }) === pathFor(target)
    navigate(target, sameSpot ? { replace: true } : undefined)
  }, [activeSection, activeViewId, hasData, urlId])

  // The conflict modal can be dismissed (keep editing); the SaveStatus badge
  // re-opens it. A fresh conflict re-opens automatically.
  const [conflictDismissed, setConflictDismissed] = useState(false)
  useEffect(() => { if (conflict) setConflictDismissed(false) }, [conflict])

  // The remote-update notice is dismissible; a fresh detection re-shows it.
  const [remoteUpdateDismissed, setRemoteUpdateDismissed] = useState(false)
  useEffect(() => { if (remoteUpdate) setRemoteUpdateDismissed(false) }, [remoteUpdate])

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
    return <BootScreen />
  }

  // ── Main editor shell ────────────────────────────────────────────────────
  // Profile and Key competencies are now separate sidebar sections; the legacy
  // combined 'profile_competencies' key still resolves (to Profile) via
  // canonicalSectionKey so old deep links / snapshots don't 404.
  const section = SECTIONS.find((s) => s.key === canonicalSectionKey(activeSection))

  return (
    <div className="app-shell">
      {/* First Tab stop: skip the ~25 sidebar items straight to the editor
          pane (WCAG 2.4.1). Visible only while focused — see index.css. */}
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} urlId={urlId} />
      {/* App-level on purpose: an advisor run finishing has to reach you
          wherever you navigated to while the model was thinking. */}
      <AdvisorToast />
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

        <ReadOnlyNotice />
        <NewerDataNotice />
        <RemoteUpdateNotice
          show={remoteUpdate && !remoteUpdateDismissed}
          onReload={reloadFromServer}
          onDismiss={() => setRemoteUpdateDismissed(true)}
        />
        <RegistryConflictNotice />

        {conflict && !conflictDismissed && (
          <ConflictModal
            mine={data}
            theirs={conflict.data}
            conflicts={conflict.conflicts}
            onResolve={resolveConflict}
            onClose={() => setConflictDismissed(true)}
          />
        )}

        {/* `ro-locked` takes the editing controls out of reach on a colleague's
            shared CV. The store already refuses every mutation, so this is the
            legibility half, not the enforcement half — a field that quietly
            snapped back to its old value would just read as a broken page.
            Text stays selectable: reading and copying is the whole point of a
            shared CV. */}
        <div
          id="main-content"
          tabIndex={-1}
          aria-readonly={readOnly || undefined}
          className={
            `app-content${activeSection === 'views' ? ' app-content-wide' : ''}${readOnly ? ' ro-locked' : ''}`
          }
        >
          {/* Reset boundary on section change so a crashed view never traps the user. */}
          <ErrorBoundary resetKey={activeSection}>
            {activeSection === 'overview'              && <Overview />}
            {activeSection === 'header'                && <HeaderEditor />}
            {activeSection === 'key_qualifications'    && <ProfileEditor />}
            {activeSection === 'key_competencies'      && <KeyCompetenciesEditor />}
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
            {/* The Skills Showcase is edited on the Skill Registry page — a
                category + highlight is all it takes to appear there — so its
                legacy key routes here too. See canonicalSectionKey(). */}
            {(activeSection === 'skills' ||
              activeSection === 'technology_categories') && <SkillsEditor />}
            {activeSection === 'roles'                 && <RolesEditor />}
            {activeSection === 'industries'            && <IndustriesEditor />}
            {activeSection === 'views'                 && <ResumeViewsEditor />}
            {activeSection === 'cover_letters'          && <CoverLettersEditor />}
          </ErrorBoundary>
        </div>
      </main>

      <style>{`
        .app-shell { display: flex; min-height: 100vh; position: relative; z-index: 1; }
        .app-main  { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .app-content { padding: 28px 36px 80px; max-width: 1000px; width: 100%; }
        /* Resume Views uses the side-by-side preview — let it span the viewport. */
        .app-content-wide { max-width: none; }
        /* Read-only: the fields LOOK inert, and nothing is blocked. Killing
           pointer events on the controls was the obvious version and the wrong
           one — expanding a card is a button, so it would have made a shared CV
           unreadable, and exporting from one is a legitimate read. No dimming
           opacity either: compositing text toward the background is how a token
           that passes contrast stops passing it (CLAUDE.md §6). */
        .ro-locked input, .ro-locked textarea, .ro-locked [role="textbox"] {
          background: var(--paper-sunken); caret-color: transparent;
        }
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

/** The connecting screen — shown while resolving the address AND while loading. */
function BootScreen() {
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
