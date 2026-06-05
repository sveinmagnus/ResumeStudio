import { useStore } from '../../store/useStore'
import { SECTIONS, GROUP_LABELS } from '../../lib/sections'
import {
  LayoutDashboard, User, FileText, Briefcase, Building2, Users,
  GraduationCap, BookOpen, Award, Layers, Languages, Presentation,
  Newspaper, Trophy, Contact, Tags, SquareUser, LayoutList, Circle,
  ListChecks, Quote,
  type LucideIcon,
} from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard, User, FileText, Briefcase, Building2, Users,
  GraduationCap, BookOpen, Award, Layers, Languages, Presentation,
  Newspaper, Trophy, Contact, Tags, SquareUser, LayoutList,
  ListChecks, Quote,
}

const YEAR = new Date().getFullYear()

export function Sidebar() {
  const { data, activeSection, activeViewId, setActiveSection, setActiveView } = useStore()

  const grouped = SECTIONS.filter((s) => !s.hidden).reduce<Record<string, typeof SECTIONS>>((acc, s) => {
    (acc[s.group] ||= []).push(s)
    return acc
  }, {})

  return (
    <aside className="sidebar">

      {/* ── Brand header ────────────────────────────────────────────── */}
      <div className="sb-brand">
        <div className="sb-mark">
          <img src="/cartavio-symbol.png" alt="" className="sb-mark-img" />
        </div>
        <div className="sb-brand-text">
          <div className="sb-title">Cartavio Resume Studio</div>
          <div className="sb-sub">{data.resume?.full_name || 'New resume'}</div>
        </div>
      </div>

      {/* ── Section navigation ───────────────────────────────────────── */}
      <nav className="sb-nav">
        {Object.entries(grouped).map(([group, items]) => (
          <div key={group} className="sb-group">
            <div className="sb-group-label">{GROUP_LABELS[group]}</div>
            {items.map((s) => {
              const Icon = ICON_MAP[s.icon] || Circle
              const count = s.storeKey ? (data[s.storeKey] as unknown[]).length : null

              // The Resume Views item gets a sub-list so each view is reachable
              // directly from the nav (parent → the view list).
              if (s.key === 'views') {
                const onList = activeSection === 'views' && !activeViewId
                return (
                  <div key={s.key}>
                    <button
                      className={`sb-item ${onList ? 'active' : ''}`}
                      onClick={() => setActiveView(null)}
                    >
                      <Icon size={16} />
                      <span className="sb-item-label">{s.label}</span>
                      {count !== null && <span className="sb-count">{count}</span>}
                    </button>
                    {data.views.length > 0 && (
                      <div className="sb-subnav">
                        {data.views.map((v) => {
                          const vActive = activeSection === 'views' && activeViewId === v.id
                          return (
                            <button
                              key={v.id}
                              className={`sb-subitem ${vActive ? 'active' : ''}`}
                              onClick={() => setActiveView(v.id)}
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

              const active = activeSection === s.key
              return (
                <button
                  key={s.key}
                  className={`sb-item ${active ? 'active' : ''}`}
                  onClick={() => setActiveSection(s.key)}
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

        /* ── Brand ── */
        .sb-brand {
          display: flex; align-items: center; gap: 12px;
          padding: 20px 18px 16px;
          border-bottom: 1px solid rgba(244,241,234,0.1);
        }
        .sb-mark {
          width: 38px; height: 38px; border-radius: 8px; flex-shrink: 0;
          background: #fff; display: grid; place-items: center; padding: 4px;
        }
        .sb-mark-img { width: 100%; height: 100%; object-fit: contain; }
        .sb-brand-text { min-width: 0; }
        .sb-title {
          font-family: var(--serif); font-size: 15px; line-height: 1.15;
          color: rgba(244,241,234,0.95); white-space: nowrap;
        }
        .sb-sub { font-size: 11.5px; color: var(--ink-faint); margin-top: 2px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* ── Nav ── */
        .sb-nav { flex: 1; padding: 14px 12px 20px; }
        .sb-group { margin-bottom: 18px; }
        .sb-group-label {
          font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
          color: var(--ink-faint); padding: 0 10px; margin-bottom: 6px;
        }
        .sb-item {
          display: flex; align-items: center; gap: 11px; width: 100%;
          padding: 8px 10px; border-radius: var(--r-sm); color: rgba(244,241,234,0.72);
          font-size: 13.5px; font-weight: 500; text-align: left; transition: all .13s;
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
          text-align: left; transition: all .13s; margin-bottom: 1px;
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
          font-size: 11px; color: rgba(244,241,234,0.3);
        }
        .sb-footer-link {
          color: rgba(244,241,234,0.3); text-decoration: none; transition: color .15s;
        }
        .sb-footer-link:hover { color: rgba(244,241,234,0.65); }
      `}</style>
    </aside>
  )
}
