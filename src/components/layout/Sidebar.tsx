import { useStore } from '../../store/useStore'
import { SECTIONS, GROUP_LABELS } from '../../lib/sections'
import {
  LayoutDashboard, User, FileText, Briefcase, Building2, Users,
  GraduationCap, BookOpen, Award, Layers, Languages, Presentation,
  Newspaper, Trophy, Contact, Tags, SquareUser, LayoutList, Circle,
  type LucideIcon,
} from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard, User, FileText, Briefcase, Building2, Users,
  GraduationCap, BookOpen, Award, Layers, Languages, Presentation,
  Newspaper, Trophy, Contact, Tags, SquareUser, LayoutList,
}

const YEAR = new Date().getFullYear()

export function Sidebar() {
  const { data, activeSection, setActiveSection } = useStore()

  const grouped = SECTIONS.reduce<Record<string, typeof SECTIONS>>((acc, s) => {
    (acc[s.group] ||= []).push(s)
    return acc
  }, {})

  return (
    <aside className="sidebar">

      {/* ── Brand header ────────────────────────────────────────────── */}
      <div className="sb-brand">
        <div className="sb-logo-wrap">
          <img src="/cartavio-logo.png" alt="Cartavio" className="sb-logo" />
        </div>
        <div className="sb-app-name">Resume Studio</div>
        <div className="sb-sub">{data.resume?.full_name || 'New resume'}</div>
      </div>

      {/* ── Section navigation ───────────────────────────────────────── */}
      <nav className="sb-nav">
        {Object.entries(grouped).map(([group, items]) => (
          <div key={group} className="sb-group">
            <div className="sb-group-label">{GROUP_LABELS[group]}</div>
            {items.map((s) => {
              const Icon = ICON_MAP[s.icon] || Circle
              const count = s.storeKey ? (data[s.storeKey] as unknown[]).length : null
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
          padding: 20px 18px 16px;
          border-bottom: 1px solid rgba(244,241,234,0.1);
        }
        .sb-logo-wrap {
          display: inline-block;
          background: #fff; border-radius: var(--r-sm);
          padding: 6px 10px; margin-bottom: 11px;
          line-height: 0;
        }
        .sb-logo { display: block; width: 128px; height: auto; }
        .sb-app-name {
          font-family: var(--serif); font-size: 15px;
          color: rgba(244,241,234,0.9); letter-spacing: .01em;
        }
        .sb-sub { font-size: 11.5px; color: var(--ink-faint); margin-top: 2px; }

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
