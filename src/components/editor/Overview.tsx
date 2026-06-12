import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, MoreHorizontal, Trash2, FileSearch, X } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { LOCALE_LABELS, resolve } from '../../lib/locales'
import { computeCompleteness, computeSectionCoverage, type MissingField, type SectionCoverage } from '../../lib/completeness'
import { wipeLocale } from '../../lib/wipeLocale'
import { useDialog } from '../ui/useDialog'

interface CoreStat { label: string; count: number; key: string }
interface CompactStat { label: string; count: number; key: string }

export function Overview() {
  const { data, setActiveSection, setExpandedItem, replaceData, setPrimaryLocale, setSecondaryLocale, primaryLocale, secondaryLocale } = useStore()
  const locales = data.resume?.supported_locales || ['en']

  // Core experience: the substantive content sections — get prominent cards.
  const core: CoreStat[] = [
    { label: 'Projects',       count: data.projects.length,        key: 'projects' },
    { label: 'Employment',     count: data.work_experiences.length, key: 'work_experiences' },
    { label: 'Education',      count: data.educations.length,       key: 'educations' },
    { label: 'Courses',        count: data.courses.length,          key: 'courses' },
    { label: 'Certifications', count: data.certifications.length,   key: 'certifications' },
  ]

  // Structural / supporting: smaller pill row — these are reference data,
  // registries, or short-form content that doesn't anchor a CV.
  const compact: CompactStat[] = [
    { label: 'Skills',           count: data.skills.length,                key: 'skills' },
    { label: 'Roles',            count: data.roles.length,                 key: 'roles' },
    { label: 'Languages',        count: data.spoken_languages.length,      key: 'spoken_languages' },
    { label: 'Skills Showcase',  count: data.technology_categories.length, key: 'technology_categories' },
    { label: 'Presentations',    count: data.presentations.length,         key: 'presentations' },
    { label: 'Publications',     count: data.publications.length,          key: 'publications' },
    { label: 'Awards',           count: data.honor_awards.length,          key: 'honor_awards' },
  ]

  const completeness = computeCompleteness(data, locales)

  // Only one locale's drill-down is open at a time. Click an already-open
  // locale to collapse it.
  const [openLocale, setOpenLocale] = useState<string | null>(null)
  const [menuLocale, setMenuLocale] = useState<string | null>(null)
  const [confirmWipe, setConfirmWipe] = useState<string | null>(null)
  const [coverageLocale, setCoverageLocale] = useState<string | null>(null)

  const goToField = (m: MissingField) => {
    setActiveSection(m.section)
    if (m.itemId) setExpandedItem(m.itemId)
  }

  const doWipe = (locale: string) => {
    const wiped = wipeLocale(data, locale)
    // If we just deleted the active primary/secondary, fall back to whatever
    // the wiped resume now reports as its first supported locale.
    const next = wiped.resume?.supported_locales[0] ?? 'en'
    if (primaryLocale === locale) setPrimaryLocale(next)
    if (secondaryLocale === locale) {
      const alt = wiped.resume?.supported_locales.find((l) => l !== primaryLocale) ?? null
      setSecondaryLocale(alt)
    }
    replaceData(wiped)
    setConfirmWipe(null)
    setMenuLocale(null)
    if (openLocale === locale) setOpenLocale(null)
  }

  return (
    <div className="section-pane">
      <div className="ov-hero">
        <div>
          <h2 className="ov-name">{data.resume?.full_name}</h2>
          <p className="ov-title">{resolve(data.resume?.title, locales[0])}</p>
        </div>
      </div>

      {/* Core cards */}
      <div className="ov-grid">
        {core.map((s) => (
          <button key={s.key} className="ov-stat" onClick={() => setActiveSection(s.key)}>
            <div className="ov-stat-count">{s.count}</div>
            <div className="ov-stat-label">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Compact strip for supporting sections */}
      <div className="ov-strip" aria-label="Supporting sections">
        {compact.map((s, i) => (
          <button
            key={s.key}
            className="ov-pill"
            onClick={() => setActiveSection(s.key)}
          >
            <span className="ov-pill-count">{s.count}</span>
            <span className="ov-pill-label">{s.label}</span>
            {i < compact.length - 1 && <span className="ov-pill-sep" aria-hidden="true" />}
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
              <div className="ov-trans-row-wrap">
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
                <LocaleMenu
                  locale={l}
                  open={menuLocale === l}
                  setOpen={(open) => setMenuLocale(open ? l : null)}
                  onWipe={() => setConfirmWipe(l)}
                  onShowCoverage={() => setCoverageLocale(l)}
                />
              </div>

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

      {confirmWipe && (
        <ConfirmWipeModal
          locale={confirmWipe}
          onCancel={() => setConfirmWipe(null)}
          onConfirm={() => doWipe(confirmWipe)}
        />
      )}

      {coverageLocale && (
        <SectionCoverageModal
          locale={coverageLocale}
          rows={computeSectionCoverage(data, coverageLocale)}
          onClose={() => setCoverageLocale(null)}
          onGo={(key) => {
            setActiveSection(key)
            setCoverageLocale(null)
          }}
        />
      )}

      <style>{`
        .ov-hero { margin-bottom: 28px; }
        .ov-name { font-size: 38px; }
        .ov-title { color: var(--ink-soft); font-size: 17px; margin-top: 2px; }

        /* Big core cards */
        .ov-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-bottom: 14px; }
        .ov-stat {
          background: var(--paper-raised); border: 1px solid var(--line); border-radius: var(--r-md);
          padding: 18px; text-align: left; transition: color .15s, background .15s, border-color .15s, box-shadow .15s, transform .15s;
        }
        .ov-stat:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: var(--shadow-md); }
        .ov-stat-count { font-family: var(--serif); font-size: 36px; color: var(--accent); line-height: 1; }
        .ov-stat-label { font-size: 13px; color: var(--ink-soft); margin-top: 6px; }

        /* Compact pill row */
        .ov-strip {
          display: flex; flex-wrap: wrap; gap: 4px 18px;
          padding: 10px 14px; margin-bottom: 36px;
          background: var(--paper-raised); border: 1px solid var(--line);
          border-radius: var(--r-md);
        }
        .ov-pill {
          display: inline-flex; align-items: baseline; gap: 5px;
          padding: 4px 2px; border-radius: var(--r-sm);
          font-size: 13px; color: var(--ink-soft); transition: color .12s;
          position: relative;
        }
        .ov-pill:hover { color: var(--accent); }
        .ov-pill-count {
          font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums;
          font-size: 14px;
        }
        .ov-pill-label { font-size: 12.5px; color: var(--ink-soft); }
        .ov-pill:hover .ov-pill-label { color: var(--accent); }
        .ov-pill-sep {
          position: absolute; right: -10px; top: 50%;
          width: 1px; height: 14px; background: var(--line); transform: translateY(-50%);
        }

        .ov-section-title { font-size: 22px; margin-bottom: 6px; }
        .ov-trans-hint { font-size: 12px; color: var(--ink-faint); margin-bottom: 14px; }
        .ov-trans { display: flex; flex-direction: column; gap: 4px; max-width: 680px; }
        .ov-trans-group { display: flex; flex-direction: column; }
        .ov-trans-row-wrap { display: flex; align-items: center; gap: 4px; position: relative; }
        .ov-trans-row {
          display: flex; align-items: center; gap: 10px;
          flex: 1; padding: 6px 8px; border-radius: var(--r-sm);
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
          color: var(--ink-soft); transition: color .12s, background .12s, border-color .12s, box-shadow .12s;
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

// ─── Triple-dot menu per locale ─────────────────────────────────────────────

interface LocaleMenuProps {
  locale: string
  open: boolean
  setOpen: (open: boolean) => void
  onWipe: () => void
  onShowCoverage: () => void
}

function LocaleMenu({ locale, open, setOpen, onWipe, onShowCoverage }: LocaleMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open, setOpen])

  return (
    <div className="ov-menu-wrap" ref={ref}>
      <button
        type="button"
        className="ov-menu-trigger"
        onClick={() => setOpen(!open)}
        aria-label="More options"
        title={`Options for ${LOCALE_LABELS[locale]?.name || locale}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div className="ov-menu" role="menu">
          <button
            className="ov-menu-item"
            role="menuitem"
            onClick={() => { setOpen(false); onShowCoverage() }}
          >
            <FileSearch size={13} /> Show sections missing language content
          </button>
          <div className="ov-menu-sep" role="separator" />
          <button
            className="ov-menu-item ov-menu-danger"
            role="menuitem"
            onClick={() => { setOpen(false); onWipe() }}
          >
            <Trash2 size={13} /> Delete all content in this language
          </button>
        </div>
      )}
      <style>{`
        .ov-menu-wrap { position: relative; flex-shrink: 0; }
        .ov-menu-trigger {
          width: 28px; height: 28px; display: grid; place-items: center;
          border-radius: var(--r-sm); color: var(--ink-faint); transition: color .12s, background .12s, border-color .12s, box-shadow .12s;
        }
        .ov-menu-trigger:hover { background: var(--paper-sunken); color: var(--accent); }
        .ov-menu {
          position: absolute; right: 0; top: 100%; margin-top: 4px;
          min-width: 260px; padding: 4px;
          background: var(--paper); border: 1px solid var(--line);
          border-radius: var(--r-md); box-shadow: var(--shadow-md); z-index: 20;
          animation: ov-menu-in .12s ease;
        }
        @keyframes ov-menu-in { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }
        .ov-menu-item {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 8px 12px; border-radius: var(--r-sm);
          font-size: 13px; text-align: left; color: var(--ink); transition: background .12s;
        }
        .ov-menu-item:hover { background: var(--accent-wash); color: var(--accent); }
        .ov-menu-sep { height: 1px; background: var(--line); margin: 4px 0; }
        .ov-menu-danger { color: var(--accent); }
        .ov-menu-danger:hover { background: var(--accent-wash); }
      `}</style>
    </div>
  )
}

// ─── Confirm wipe modal ─────────────────────────────────────────────────────

interface ConfirmProps {
  locale: string
  onCancel: () => void
  onConfirm: () => void
}

function ConfirmWipeModal({ locale, onCancel, onConfirm }: ConfirmProps) {
  const dialogRef = useDialog(onCancel)
  const name = `${LOCALE_LABELS[locale]?.flag ?? ''} ${LOCALE_LABELS[locale]?.name || locale}`.trim()
  return (
    <div className="ov-modal-backdrop" onClick={onCancel} role="presentation">
      <div className="ov-modal" ref={dialogRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="ov-modal-title">
        <h3 id="ov-modal-title">Delete all {name} content?</h3>
        <p>
          This removes every <strong>{name}</strong> translation from your resume —
          field by field, including project descriptions, role names, profile
          summaries, and so on. The language is also removed from the
          supported-languages list.
        </p>
        <p className="ov-modal-warn">
          This is reversible: undo with Ctrl/Cmd+Z, or restore an earlier
          snapshot from History. But once you save and close the editor, restoring
          will require a snapshot rewind.
        </p>
        <div className="ov-modal-actions">
          <button className="ov-modal-cancel" onClick={onCancel}>Cancel</button>
          <button className="ov-modal-confirm" onClick={onConfirm}>
            <Trash2 size={14} /> Delete {name} content
          </button>
        </div>
      </div>
      <style>{`
        .ov-modal-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.35);
          display: grid; place-items: center; z-index: 100;
          animation: fadeIn .15s ease;
        }
        .ov-modal {
          background: var(--paper); border-radius: var(--r-md);
          padding: 26px 28px; max-width: 520px; width: 90vw;
          box-shadow: var(--shadow-lg);
        }
        .ov-modal h3 { font-size: 22px; margin-bottom: 12px; }
        .ov-modal p { font-size: 14px; color: var(--ink-soft); margin-bottom: 10px; line-height: 1.55; }
        .ov-modal-warn { font-size: 13px; color: var(--ink-faint); }
        .ov-modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; }
        .ov-modal-cancel {
          padding: 9px 16px; border: 1px solid var(--line-strong); border-radius: var(--r-sm);
          font-weight: 600; font-size: 13px; color: var(--ink-soft);
        }
        .ov-modal-cancel:hover { border-color: var(--accent); color: var(--accent); }
        .ov-modal-confirm {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 9px 18px; border-radius: var(--r-sm);
          background: var(--accent); color: var(--paper-raised);
          font-weight: 600; font-size: 13px; transition: background .15s;
        }
        .ov-modal-confirm:hover { background: var(--accent-bright); }
      `}</style>
    </div>
  )
}

// ─── Section-coverage modal ─────────────────────────────────────────────────

interface CoverageProps {
  locale: string
  rows: SectionCoverage[]
  onClose: () => void
  onGo: (sectionKey: string) => void
}

function SectionCoverageModal({ locale, rows, onClose, onGo }: CoverageProps) {
  // Focus trap + Escape + focus restore (shared dialog behaviour).
  const dialogRef = useDialog(onClose)
  const name = `${LOCALE_LABELS[locale]?.flag ?? ''} ${LOCALE_LABELS[locale]?.name || locale}`.trim()

  // Three buckets help the consultant scan: completely missing, partial, full.
  // Empty sections are tagged separately so they don't pollute "missing".
  const missing = rows.filter((r) => r.total > 0 && r.populated === 0)
  const partial = rows.filter((r) => r.total > 0 && r.populated > 0 && r.populated < r.total)
  const complete = rows.filter((r) => r.total > 0 && r.populated === r.total)
  const empty = rows.filter((r) => r.total === 0)

  return (
    <div className="ov-cov-backdrop" role="presentation" onClick={onClose}>
      <div className="ov-cov" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ov-cov-title" onClick={(e) => e.stopPropagation()}>
        <div className="ov-cov-head">
          <div>
            <h3 id="ov-cov-title">Sections missing {name} content</h3>
            <p className="ov-cov-sub">
              Per-section coverage in {name}. Click a row to jump to that section.
            </p>
          </div>
          <button className="ov-cov-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <CoverageBucket
          title="Entirely missing"
          tone="warn"
          rows={missing}
          onGo={onGo}
          emptyMessage={`No section is completely empty in ${name}.`}
        />
        <CoverageBucket
          title="Partial"
          tone="muted"
          rows={partial}
          onGo={onGo}
          emptyMessage="No sections are partially translated."
        />
        <CoverageBucket
          title="Complete"
          tone="ok"
          rows={complete}
          onGo={onGo}
          emptyMessage="No sections are fully covered yet."
        />
        {empty.length > 0 && (
          <CoverageBucket
            title="Sections with no items"
            tone="muted"
            rows={empty}
            onGo={onGo}
            emptyMessage=""
          />
        )}
      </div>
      <style>{`
        .ov-cov-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.35);
          display: grid; place-items: center; z-index: 100;
          animation: fadeIn .15s ease;
        }
        .ov-cov {
          background: var(--paper); border-radius: var(--r-md);
          padding: 22px 24px; width: min(640px, 92vw);
          max-height: 86vh; overflow-y: auto;
          box-shadow: var(--shadow-lg);
        }
        .ov-cov-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
        .ov-cov-head h3 { font-size: 20px; }
        .ov-cov-sub { font-size: 12.5px; color: var(--ink-faint); margin-top: 4px; }
        .ov-cov-close {
          width: 30px; height: 30px; display: grid; place-items: center;
          border-radius: var(--r-sm); color: var(--ink-faint); transition: color .12s, background .12s, border-color .12s, box-shadow .12s;
        }
        .ov-cov-close:hover { background: var(--paper-sunken); color: var(--accent); }
      `}</style>
    </div>
  )
}

interface BucketProps {
  title: string
  tone: 'warn' | 'ok' | 'muted'
  rows: SectionCoverage[]
  onGo: (sectionKey: string) => void
  emptyMessage: string
}

function CoverageBucket({ title, tone, rows, onGo, emptyMessage }: BucketProps) {
  if (rows.length === 0 && !emptyMessage) return null
  return (
    <div className="ov-cov-bucket">
      <div className={`ov-cov-bucket-head ov-cov-tone-${tone}`}>
        <span className="ov-cov-bucket-title">{title}</span>
        <span className="ov-cov-bucket-count">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="ov-cov-empty">{emptyMessage}</div>
      ) : (
        <ul className="ov-cov-list">
          {rows.map((r) => {
            const ratio = r.total ? Math.round((r.populated / r.total) * 100) : 0
            return (
              <li key={r.key}>
                <button className="ov-cov-row" onClick={() => onGo(r.key)}>
                  <span className="ov-cov-label">{r.label}</span>
                  <span className="ov-cov-stat">
                    <span className="ov-cov-stat-num">{r.populated}</span>
                    <span className="ov-cov-stat-of"> of </span>
                    <span className="ov-cov-stat-num">{r.total}</span>
                    {r.total > 0 && <span className="ov-cov-stat-pct"> · {ratio}%</span>}
                  </span>
                  <ChevronRight size={14} className="ov-cov-go" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <style>{`
        .ov-cov-bucket { margin-bottom: 16px; }
        .ov-cov-bucket-head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 5px 10px; border-radius: var(--r-sm);
          font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
          margin-bottom: 4px;
        }
        .ov-cov-tone-warn { color: var(--accent); background: var(--accent-wash); }
        .ov-cov-tone-ok { color: var(--secondary-ink-text); background: var(--secondary-tint); }
        .ov-cov-tone-muted { color: var(--ink-faint); background: var(--paper-sunken); }
        .ov-cov-bucket-count { font-variant-numeric: tabular-nums; opacity: .8; }
        .ov-cov-empty {
          padding: 8px 12px; font-size: 12.5px; color: var(--ink-faint);
        }
        .ov-cov-list { list-style: none; display: flex; flex-direction: column; gap: 1px; }
        .ov-cov-row {
          display: flex; align-items: center; gap: 12px;
          width: 100%; padding: 8px 12px; border-radius: var(--r-sm);
          text-align: left; transition: background .12s; color: var(--ink);
        }
        .ov-cov-row:hover { background: var(--accent-wash); color: var(--accent); }
        .ov-cov-label { flex: 1; font-weight: 500; font-size: 13.5px; }
        .ov-cov-stat { font-size: 12.5px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
        .ov-cov-row:hover .ov-cov-stat { color: var(--accent); }
        .ov-cov-stat-num { font-weight: 600; color: var(--ink); }
        .ov-cov-row:hover .ov-cov-stat-num { color: var(--accent); }
        .ov-cov-stat-of { opacity: .7; }
        .ov-cov-stat-pct { opacity: .85; }
        .ov-cov-go { color: var(--ink-faint); flex-shrink: 0; }
        .ov-cov-row:hover .ov-cov-go { color: var(--accent); }
      `}</style>
    </div>
  )
}
