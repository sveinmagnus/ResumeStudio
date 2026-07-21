import { useEffect } from 'react'
import { useStore } from '../../store/useStore'
import { Link } from '../../lib/router'
import { SECTIONS, GROUP_LABELS, GROUP_ORDER, canonicalSectionKey } from '../../lib/sections'
import {
  LayoutDashboard, User, FileText, Briefcase, Building2, Users,
  GraduationCap, BookOpen, Award, Layers, Languages, Presentation,
  Newspaper, Trophy, Contact, Tags, SquareUser, LayoutList, Circle,
  ListChecks, Quote, Mail, X,
  type LucideIcon,
} from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard, User, FileText, Briefcase, Building2, Users,
  GraduationCap, BookOpen, Award, Layers, Languages, Presentation,
  Newspaper, Trophy, Contact, Tags, SquareUser, LayoutList,
  ListChecks, Quote, Mail,
}

const YEAR = new Date().getFullYear()

/**
 * The editor's primary navigation. Visible inline at wide viewports; at
 * narrow widths (under ~880px) it folds away and reopens as a slide-in
 * drawer when the AppHeader's hamburger is pressed. The same component
 * handles both modes — CSS picks which behaviour applies, the React state
 * just toggles an `is-open` class + a backdrop.
 *
 * Props are optional so anywhere that mounts a bare `<Sidebar />` (e.g.
 * a test or a future layout) still gets the wide-viewport behaviour.
 */
export interface SidebarProps {
  /** Drawer open state on narrow viewports. Ignored when CSS shows the inline sidebar. */
  isOpen?: boolean
  /** Close request — backdrop click, Esc key, or a nav item being selected. */
  onClose?: () => void
}

export function Sidebar({ isOpen = false, onClose }: SidebarProps = {}) {
  const { data, activeSection, activeViewId, setActiveSection, setActiveView } = useStore()

  // Close on Esc + lock body scroll while the drawer is open. The CSS media
  // query owns "is this actually drawer mode?", so we always attach these
  // handlers when isOpen is true — they're no-ops on wide screens (no Esc to
  // press, no scroll to lock since the sidebar is in-flow anyway).
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [isOpen, onClose])

  const grouped = SECTIONS.filter((s) => !s.hidden).reduce<Record<string, typeof SECTIONS>>((acc, s) => {
    (acc[s.group] ||= []).push(s)
    return acc
  }, {})
  // Render groups in GROUP_ORDER (export-first), not SECTIONS order.
  const groupedEntries = GROUP_ORDER.flatMap((g) => {
    const items = grouped[g]
    return items && items.length > 0 ? [[g, items] as const] : []
  })

  // Wrap navigation handlers so a click closes the drawer on mobile. On
  // desktop onClose is still called but the sidebar is always visible, so it's
  // harmless.
  const goSection = (key: string) => { setActiveSection(key); onClose?.() }
  const goView = (id: string | null) => { setActiveView(id); onClose?.() }

  return (
    <>
      {/* Backdrop sits between the page and the drawer. CSS handles when it
          actually shows (only at narrow widths + when open). Clicking it
          closes the drawer; on wide screens it stays display:none and never
          intercepts clicks. */}
      <div
        className={`sb-backdrop ${isOpen ? 'is-open' : ''}`}
        onClick={() => onClose?.()}
        aria-hidden="true"
      />

      <aside
        className={`sidebar ${isOpen ? 'is-open' : ''}`}
        aria-label="Section navigation"
      >
        {/* ── Brand header ────────────────────────────────────────────── */}
        <div className="sb-brand">
          <Link to="/" className="sb-mark" aria-label="All resumes" title="All resumes" onClick={() => onClose?.()}>
            <img src="/cartavio-symbol.png" alt="" className="sb-mark-img" />
          </Link>
          <div className="sb-brand-text">
            <div className="sb-title">Cartavio Resume Studio</div>
            <div className="sb-sub">{data.resume?.full_name || 'New resume'}</div>
          </div>
          {/* Close button is only visible in drawer mode (see CSS). It mirrors
              the hamburger in the AppHeader so the drawer has a self-evident
              dismiss affordance even before the user discovers Esc/backdrop. */}
          <button
            type="button"
            className="sb-close"
            onClick={() => onClose?.()}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Section navigation ───────────────────────────────────────── */}
        <nav className="sb-nav">
          {groupedEntries.map(([group, items]) => (
            <div key={group} className="sb-group">
              <div className="sb-group-label">{GROUP_LABELS[group]}</div>
              {items.map((s) => {
                const Icon = ICON_MAP[s.icon] || Circle
                // A store entering from an old backup or snapshot can predate a
                // section's array (added in a later version); treat a missing
                // array as empty rather than crashing the entire nav over a
                // cosmetic count. Normal loads backfill via freshStore/migrate.
                const count = s.storeKey ? ((data[s.storeKey] as unknown[] | undefined)?.length ?? 0) : null

                // The Resume Views item gets a sub-list so each view is reachable
                // directly from the nav (parent → the view list).
                if (s.key === 'views') {
                  const onList = activeSection === 'views' && !activeViewId
                  return (
                    <div key={s.key}>
                      <button
                        className={`sb-item ${onList ? 'active' : ''}`}
                        aria-current={onList ? 'true' : undefined}
                        onClick={() => goView(null)}
                      >
                        <Icon size={16} />
                        <span className="sb-item-label">{s.label}</span>
                        {count !== null && <span className="sb-count">{count}</span>}
                      </button>
                      {(data.views?.length ?? 0) > 0 && (
                        <div className="sb-subnav">
                          {(data.views ?? []).map((v) => {
                            const vActive = activeSection === 'views' && activeViewId === v.id
                            return (
                              <button
                                key={v.id}
                                className={`sb-subitem ${vActive ? 'active' : ''}`}
                                aria-current={vActive ? 'true' : undefined}
                                onClick={() => goView(v.id)}
                                title={v.name}
                              >
                                <span className="sb-subdot" />
                                <span className="sb-item-label">{v.name}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                }

                // Alias-aware: the legacy 'profile_competencies' key highlights
                // the Profile item (see canonicalSectionKey).
                const active = canonicalSectionKey(activeSection) === s.key
                return (
                  <button
                    key={s.key}
                    className={`sb-item ${active ? 'active' : ''}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => goSection(s.key)}
                  >
                    <Icon size={16} />
                    <span className="sb-item-label">{s.label}</span>
                    {count !== null && <span className="sb-count">{count}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <footer className="sb-footer">
          <div className="sb-footer-copy">© {YEAR} Cartavio AS</div>
          <a
            href="https://cartavio.no"
            className="sb-footer-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            cartavio.no
          </a>
        </footer>

        <style>{`
          .sidebar {
            width: 260px; flex-shrink: 0; height: 100vh; overflow-y: auto;
            background: var(--ink); color: var(--paper);
            display: flex; flex-direction: column; position: sticky; top: 0;
          }
          /* The global navy focus ring is invisible on this dark surface —
             swap it for the light cyan inside the sidebar. */
          .sidebar :focus-visible { outline-color: var(--secondary-line); }

          /* ── Brand ── */
          .sb-brand {
            display: flex; align-items: center; gap: 12px;
            padding: 20px 18px 16px;
            border-bottom: 1px solid rgba(244,241,234,0.1);
          }
          .sb-mark {
            width: 38px; height: 38px; border-radius: 8px; flex-shrink: 0;
            background: #fff; display: grid; place-items: center; padding: 4px;
            cursor: pointer; text-decoration: none;
            transition: box-shadow .13s, transform .13s;
          }
          .sb-mark:hover { box-shadow: 0 0 0 2px var(--secondary-ink); transform: translateY(-1px); }
          .sb-mark-img { width: 100%; height: 100%; object-fit: contain; }
          .sb-brand-text { min-width: 0; flex: 1; }
          .sb-title {
            font-family: var(--serif); font-size: 15px; line-height: 1.15;
            color: rgba(244,241,234,0.95); white-space: nowrap;
          }
          .sb-sub { font-size: 11.5px; color: rgba(244,241,234,0.58); margin-top: 2px;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

          /* The close button only shows in drawer mode (see media query). */
          .sb-close {
            display: none; width: 32px; height: 32px; place-items: center;
            border-radius: var(--r-sm);
            background: rgba(244,241,234,0.06); color: rgba(244,241,234,0.75);
            transition: color .13s, background .13s, border-color .13s, box-shadow .13s;
          }
          .sb-close:hover { background: rgba(244,241,234,0.14); color: #fff; }

          /* ── Nav ── */
          .sb-nav { flex: 1; padding: 14px 12px 20px; }
          .sb-group { margin-bottom: 18px; }
          .sb-group-label {
            font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
            color: rgba(244,241,234,0.58); padding: 0 10px; margin-bottom: 6px;
          }
          .sb-item {
            display: flex; align-items: center; gap: 11px; width: 100%;
            padding: 8px 10px; border-radius: var(--r-sm); color: rgba(244,241,234,0.72);
            font-size: 13.5px; font-weight: 500; text-align: left; transition: color .13s, background .13s, border-color .13s, box-shadow .13s;
            margin-bottom: 1px;
          }
          .sb-item:hover { background: rgba(244,241,234,0.07); color: var(--paper); }
          .sb-item.active { background: var(--accent); color: #fff; }
          .sb-item-label { flex: 1; }
          .sb-count {
            font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 10px;
            background: rgba(244,241,234,0.12); color: rgba(244,241,234,0.85);
          }
          .sb-item.active .sb-count { background: rgba(255,255,255,0.22); color: #fff; }

          /* ── Views sub-nav ── */
          .sb-subnav {
            display: flex; flex-direction: column;
            margin: 2px 0 2px 10px; padding-left: 12px;
            border-left: 1px solid rgba(244,241,234,0.12);
          }
          .sb-subitem {
            display: flex; align-items: center; gap: 9px; width: 100%;
            padding: 6px 10px; border-radius: var(--r-sm);
            color: rgba(244,241,234,0.62); font-size: 12.5px; font-weight: 500;
            text-align: left; transition: color .13s, background .13s, border-color .13s, box-shadow .13s; margin-bottom: 1px;
          }
          .sb-subitem:hover { background: rgba(244,241,234,0.07); color: var(--paper); }
          .sb-subitem.active { background: var(--accent); color: #fff; }
          .sb-subdot {
            width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0;
            background: currentColor; opacity: .6;
          }
          .sb-subitem .sb-item-label {
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          }

          /* ── Footer ── */
          .sb-footer {
            padding: 14px 18px;
            border-top: 1px solid rgba(244,241,234,0.08);
            display: flex; align-items: center; justify-content: space-between;
            font-size: 11px; color: rgba(244,241,234,0.55);
          }
          .sb-footer-link {
            color: rgba(244,241,234,0.55); text-decoration: none; transition: color .15s;
          }
          .sb-footer-link:hover { color: rgba(244,241,234,0.65); }

          /* ── Backdrop (drawer mode only) ── */
          .sb-backdrop {
            display: none;
            position: fixed; inset: 0;
            background: rgba(15, 23, 42, .45);
            z-index: 90;
            opacity: 0;
            transition: opacity .18s ease;
          }

          /* ── Drawer mode ─────────────────────────────────────────────
             Below 880px the sidebar leaves the flex flow and becomes a
             fixed-position drawer that slides in from the left. The hamburger
             in AppHeader toggles isOpen on the parent. */
          @media (max-width: 880px) {
            .sidebar {
              position: fixed; top: 0; left: 0;
              width: min(280px, 86vw); height: 100vh;
              transform: translateX(-100%);
              transition: transform .22s ease;
              z-index: 100;
              box-shadow: 0 10px 40px rgba(0, 0, 0, .35);
            }
            .sidebar.is-open { transform: translateX(0); }
            .sb-close { display: grid; }
            .sb-backdrop { display: block; pointer-events: none; }
            .sb-backdrop.is-open { opacity: 1; pointer-events: auto; }
          }

          /* Respect users who prefer reduced motion. */
          @media (prefers-reduced-motion: reduce) {
            .sidebar, .sb-backdrop { transition: none; }
          }
        `}</style>
      </aside>
    </>
  )
}
