import type { SectionStyle, SectionDetail, Density, TagStyle, DividerStyle, LocalizedString } from '../../../types'
import { Sliders, RotateCcw } from 'lucide-react'
import { DualField } from '../../ui/DualField'

// Sections whose items actually render skill tags — the only place a per-section
// "Tag style" override is meaningful (see lib/sectionCatalog.ts: projects,
// key_qualifications and the Skills Showcase set `tags`).
const TAG_SECTIONS = new Set(['projects', 'key_qualifications', 'technology_categories'])

const anyLocale = (v: LocalizedString): boolean => Object.values(v).some((x) => (x ?? '').trim() !== '')

// ─── Detail toggle ──────────────────────────────────────────────────────────

export function DetailToggle({ value, onChange }: { value: SectionDetail; onChange: (d: SectionDetail) => void }) {
  const opts: SectionDetail[] = ['off', 'summary', 'full']
  return (
    <div className="rv-detail-toggle" role="radiogroup" aria-label="Section detail level">
      {opts.map((opt) => (
        <button
          key={opt}
          type="button"
          role="radio"
          aria-checked={value === opt}
          className={`rv-detail-opt ${value === opt ? 'is-active' : ''}`}
          onClick={() => onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

// ─── Per-section style panel (collapsed by default) ─────────────────────────

interface SectionStylePanelProps {
  sectionKey: string
  style: SectionStyle | undefined
  onChange: (patch: SectionStyle) => void
  onReset: () => void
  hasStyle: boolean
}

export function SectionStylePanel({ sectionKey, style, onChange, onReset, hasStyle }: SectionStylePanelProps) {
  const s: SectionStyle = style ?? {}
  const showTag = TAG_SECTIONS.has(sectionKey)
  return (
    <details className="rv-secstyle">
      <summary className="rv-secstyle-summary">
        <Sliders size={11} /> Style overrides
        {hasStyle && <span className="rv-secstyle-badge">custom</span>}
        {hasStyle && (
          <button
            type="button"
            className="rv-secstyle-reset"
            onClick={(e) => { e.preventDefault(); onReset() }}
            title="Use view defaults for this section"
          >
            <RotateCcw size={10} /> Reset
          </button>
        )}
      </summary>
      <div className="rv-secstyle-body">
        {/* Toggles on the left — checkbox before its label so what's on is clear. */}
        <div className="rv-secstyle-toggles">
          <label className="rv-toggle">
            <input
              type="checkbox"
              checked={!!s.hide_heading}
              onChange={(e) => onChange({ hide_heading: e.target.checked || undefined })}
            />
            <span>Hide section heading</span>
          </label>
          <label className="rv-toggle">
            <input
              type="checkbox"
              checked={!!s.hide_dates}
              onChange={(e) => onChange({ hide_dates: e.target.checked || undefined })}
            />
            <span>Hide dates</span>
          </label>
          <label className="rv-toggle">
            <input
              type="checkbox"
              checked={!!s.tabulate}
              onChange={(e) => onChange({ tabulate: e.target.checked || undefined })}
            />
            <span>Tabulate summary</span>
          </label>
        </div>
        {/* Dropdowns on the right. Labelled by their visible span (not a wrapping
            <label>) so they don't collide with the identically-named view-wide
            controls in automated/AT queries. */}
        <div className="rv-secstyle-selects">
          <div className="rv-sel">
            <span>Density</span>
            <select
              aria-label="Section density override"
              value={s.density ?? ''}
              onChange={(e) => onChange({ density: (e.target.value || undefined) as Density | undefined })}
            >
              <option value="">— view default —</option>
              <option value="compact">Compact</option>
              <option value="normal">Normal</option>
              <option value="spacious">Spacious</option>
            </select>
          </div>
          <div className="rv-sel">
            <span>Item layout</span>
            <select
              aria-label="Section item layout"
              value={s.date_position ?? ''}
              onChange={(e) => onChange({ date_position: (e.target.value || undefined) as 'default' | 'leading' | undefined })}
            >
              <option value="">— view default —</option>
              <option value="default">Title first</option>
              <option value="leading">Date &amp; details first</option>
            </select>
          </div>
          {showTag && (
            <div className="rv-sel">
              <span>Tag style</span>
              <select
                aria-label="Section tag-style override"
                value={s.tag_style ?? ''}
                onChange={(e) => onChange({ tag_style: (e.target.value || undefined) as TagStyle | undefined })}
              >
                <option value="">— view default —</option>
                <option value="chips">Chips</option>
                <option value="inline">Inline list</option>
              </select>
            </div>
          )}
          <div className="rv-sel">
            <span>Item divider</span>
            <select
              aria-label="Section item-divider override"
              value={s.item_divider === false ? 'off' : (s.divider_style ?? '')}
              onChange={(e) => {
                const v = e.target.value
                if (v === '') onChange({ item_divider: undefined, divider_style: undefined })
                else if (v === 'off') onChange({ item_divider: false, divider_style: undefined })
                else onChange({ item_divider: true, divider_style: v as DividerStyle })
              }}
            >
              <option value="">— view default —</option>
              <option value="off">None</option>
              <option value="line">Full line</option>
              <option value="short">Short line</option>
              <option value="thick">Thick line</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
              <option value="double">Double</option>
              <option value="space">Space only</option>
            </select>
          </div>
        </div>
      </div>
      {!s.hide_heading && (
        <div className="rv-secstyle-heading">
          <DualField
            label="Custom heading (replaces the section title)"
            value={s.heading_text ?? {}}
            onChange={(v) => onChange({ heading_text: anyLocale(v) ? v : undefined })}
            placeholder="Leave blank to keep the default title"
          />
        </div>
      )}
    </details>
  )
}
