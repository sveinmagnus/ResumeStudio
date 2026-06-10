import type { SectionStyle, SectionDetail, Density, TagStyle } from '../../../types'
import { Sliders, RotateCcw } from 'lucide-react'

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

export function SectionStylePanel({ style, onChange, onReset, hasStyle }: SectionStylePanelProps) {
  const s: SectionStyle = style ?? {}
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
        <div className="rv-secstyle-row">
          <span>Density</span>
          <select
            value={s.density ?? ''}
            onChange={(e) => onChange({ density: (e.target.value || undefined) as Density | undefined })}
          >
            <option value="">— view default —</option>
            <option value="compact">Compact</option>
            <option value="normal">Normal</option>
            <option value="spacious">Spacious</option>
          </select>
        </div>
        <div className="rv-secstyle-row">
          <span>Tag style</span>
          <select
            value={s.tag_style ?? ''}
            onChange={(e) => onChange({ tag_style: (e.target.value || undefined) as TagStyle | undefined })}
          >
            <option value="">— view default —</option>
            <option value="chips">Chips</option>
            <option value="inline">Inline list</option>
          </select>
        </div>
        <label className="rv-secstyle-row">
          <span>Hide section heading</span>
          <input
            type="checkbox"
            checked={!!s.hide_heading}
            onChange={(e) => onChange({ hide_heading: e.target.checked || undefined })}
          />
        </label>
        <label className="rv-secstyle-row">
          <span>Hide dates</span>
          <input
            type="checkbox"
            checked={!!s.hide_dates}
            onChange={(e) => onChange({ hide_dates: e.target.checked || undefined })}
          />
        </label>
        <label className="rv-secstyle-row">
          <span>Item dividers</span>
          <select
            value={s.item_divider === undefined ? '' : s.item_divider ? 'on' : 'off'}
            onChange={(e) => {
              const v = e.target.value
              onChange({ item_divider: v === '' ? undefined : v === 'on' })
            }}
          >
            <option value="">— view default —</option>
            <option value="on">Show</option>
            <option value="off">Hide</option>
          </select>
        </label>
      </div>
    </details>
  )
}
