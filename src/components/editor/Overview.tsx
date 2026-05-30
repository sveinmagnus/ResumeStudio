import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { LOCALE_LABELS, resolve } from '../../lib/locales'
import { computeCompleteness, type MissingField } from '../../lib/completeness'

export function Overview() {
  const { data, setActiveSection, setExpandedItem } = useStore()
  const locales = data.resume?.supported_locales || ['en']

  const stats = [
    { label: 'Projects', count: data.projects.length, key: 'projects' },
    { label: 'Employment', count: data.work_experiences.length, key: 'work_experiences' },
    { label: 'Education', count: data.educations.length, key: 'educations' },
    { label: 'Courses', count: data.courses.length, key: 'courses' },
    { label: 'Certifications', count: data.certifications.length, key: 'certifications' },
    { label: 'Skills', count: data.skills.length, key: 'skills' },
    { label: 'Roles', count: data.roles.length, key: 'roles' },
    { label: 'Languages', count: data.spoken_languages.length, key: 'spoken_languages' },
  ]

  const completeness = computeCompleteness(data, locales)

  // Only one locale's drill-down is open at a time. Click an already-open
  // locale to collapse it.
  const [openLocale, setOpenLocale] = useState<string | null>(null)

  const goToField = (m: MissingField) => {
    setActiveSection(m.section)
    if (m.itemId) setExpandedItem(m.itemId)
  }

  return (
    <div className="section-pane">
      <div className="ov-hero">
        <div>
          <h2 className="ov-name">{data.resume?.full_name}</h2>
          <p className="ov-title">{resolve(data.resume?.title, locales[0])}</p>
        </div>
      </div>

      <div className="ov-grid">
        {stats.map((s) => (
          <button key={s.key} className="ov-stat" onClick={() => setActiveSection(s.key)}>
            <div className="ov-stat-count">{s.count}</div>
            <div className="ov-stat-label">{s.label}</div>
          </button>
        ))}
      </div>

      <h3 className="ov-section-title">Translation completeness</h3>
      <p className="ov-trans-hint">Click a row to see which fields are missing in that language.</p>
      <div className="ov-trans">
        {locales.map((l) => {
          const c = completeness[l] || { percent: 0, missing: [] }
          const isOpen = openLocale === l
          const canExpand = c.missing.length > 0
          return (
            <div key={l} className="ov-trans-group">
              <button
                type="button"
                className={`ov-trans-row${canExpand ? ' ov-trans-row-clickable' : ''}`}
                onClick={() => canExpand && setOpenLocale(isOpen ? null : l)}
                aria-expanded={isOpen}
                disabled={!canExpand}
              >
                <span className="ov-trans-chev">
                  {canExpand
                    ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)
                    : <span className="ov-trans-chev-spacer" />}
                </span>
                <span className="ov-trans-label">
                  {LOCALE_LABELS[l]?.flag} {LOCALE_LABELS[l]?.name || l}
                </span>
                <span className="ov-trans-bar">
                  <span className="ov-trans-fill" style={{ width: `${c.percent}%` }} />
                </span>
                <span className="ov-trans-pct">{c.percent}%</span>
              </button>

              {isOpen && c.missing.length > 0 && (
                <ul className="ov-missing">
                  {c.missing.map((m, i) => (
                    <li key={`${m.section}:${m.itemId ?? 'root'}:${m.fieldLabel}:${i}`}>
                      <button className="ov-missing-row" onClick={() => goToField(m)}>
                        <span className="ov-missing-item">{m.itemLabel}</span>
                        <span className="ov-missing-sep">·</span>
                        <span className="ov-missing-field">{m.fieldLabel}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      <style>{`
        .ov-hero { margin-bottom: 28px; }
        .ov-name { font-size: 38px; }
        .ov-title { color: var(--ink-soft); font-size: 17px; margin-top: 2px; }
        .ov-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 12px; margin-bottom: 36px; }
        .ov-stat {
          background: var(--paper-raised); border: 1px solid var(--line); border-radius: var(--r-md);
          padding: 18px; text-align: left; transition: all .15s;
        }
        .ov-stat:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: var(--shadow-md); }
        .ov-stat-count { font-family: var(--serif); font-size: 32px; color: var(--accent); line-height: 1; }
        .ov-stat-label { font-size: 13px; color: var(--ink-soft); margin-top: 6px; }
        .ov-section-title { font-size: 22px; margin-bottom: 6px; }
        .ov-trans-hint { font-size: 12px; color: var(--ink-faint); margin-bottom: 14px; }
        .ov-trans { display: flex; flex-direction: column; gap: 4px; max-width: 640px; }
        .ov-trans-group { display: flex; flex-direction: column; }
        .ov-trans-row {
          display: flex; align-items: center; gap: 10px;
          width: 100%; padding: 6px 8px; border-radius: var(--r-sm);
          background: transparent; text-align: left; transition: background .12s;
        }
        .ov-trans-row-clickable { cursor: pointer; }
        .ov-trans-row-clickable:hover { background: var(--accent-wash); }
        .ov-trans-row:disabled { cursor: default; }
        .ov-trans-chev { width: 16px; display: inline-flex; color: var(--ink-faint); }
        .ov-trans-chev-spacer { display: inline-block; width: 14px; }
        .ov-trans-label { width: 110px; font-size: 14px; font-weight: 500; }
        .ov-trans-bar { flex: 1; height: 9px; background: var(--paper-sunken); border-radius: 5px; overflow: hidden; }
        .ov-trans-fill { display: block; height: 100%; background: var(--accent); border-radius: 5px; transition: width .5s ease; }
        .ov-trans-pct { width: 42px; text-align: right; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
        .ov-missing {
          list-style: none; margin: 4px 0 10px 26px; padding: 6px 0;
          border-left: 2px solid var(--line); display: flex; flex-direction: column; gap: 1px;
        }
        .ov-missing-row {
          display: flex; align-items: baseline; gap: 8px;
          width: 100%; padding: 4px 12px; border-radius: var(--r-sm);
          background: transparent; text-align: left; font-size: 13px;
          color: var(--ink-soft); transition: all .12s;
        }
        .ov-missing-row:hover { background: var(--accent-wash); color: var(--accent); }
        .ov-missing-item { font-weight: 500; color: var(--ink); }
        .ov-missing-row:hover .ov-missing-item { color: var(--accent); }
        .ov-missing-sep { color: var(--ink-faint); }
        .ov-missing-field { color: var(--ink-soft); }
      `}</style>
    </div>
  )
}
