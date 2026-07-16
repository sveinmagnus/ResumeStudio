import { DEFAULT_VIEW_STYLE, DEFAULT_SUMMARY_LAYOUT, normalizeFullLayout } from '../../../lib/viewStyle'
import { fontOptions, fontInstallInfo } from '../../../lib/fonts'
import { getDefaultFonts } from '../../../lib/appPrefs'
import type { ViewStyle, Density, BodySize, PageMargin, TagStyle, DividerStyle, SummaryLayout, FullLayout, DateFormat, BulletStyle } from '../../../types'
import { RotateCcw, Download } from 'lucide-react'
import { Select } from './Select'
import { SUMMARY_LAYOUT_OPTIONS, FULL_LAYOUT_OPTIONS, DATE_FORMAT_OPTIONS, BULLET_STYLE_OPTIONS } from './SectionStylePanel'

// Font <select> options: "Inherit global default" first, then the catalog.
const FONT_SELECT_OPTIONS: Array<[string, string]> = [
  ['inherit', 'Inherit global default'],
  ...fontOptions().map((f): [string, string] => [f.id, f.label]),
]

/** Resolve a stored font value (possibly 'inherit') to a concrete catalog id. */
function effectiveFont(value: string | undefined, fallback: string): string {
  return !value || value === 'inherit' ? fallback : value
}

// ─── View styling controls ──────────────────────────────────────────────────

export function ViewStyleControls({ style, onChange }: { style: ViewStyle; onChange: (patch: Partial<ViewStyle>) => void }) {
  const resetAll = () => onChange({ ...DEFAULT_VIEW_STYLE })
  return (
    <>
      <div className="rv-vs-grid">
        <Select<Density>
          label="Density"
          value={style.density}
          options={[
            ['compact',  'Compact'],
            ['normal',   'Normal'],
            ['spacious', 'Spacious'],
          ]}
          onChange={(density) => onChange({ density })}
        />
        <Select<BodySize>
          label="Body size"
          value={style.body_size}
          options={[
            ['small',  'Small (9pt)'],
            ['normal', 'Normal (11pt)'],
            ['large',  'Large (12pt)'],
          ]}
          onChange={(body_size) => onChange({ body_size })}
        />
        <Select<string>
          label="Heading font"
          value={style.heading_font ?? 'inherit'}
          options={FONT_SELECT_OPTIONS}
          onChange={(heading_font) => onChange({ heading_font })}
        />
        <Select<string>
          label="Body font"
          value={style.body_font ?? 'inherit'}
          options={FONT_SELECT_OPTIONS}
          onChange={(body_font) => onChange({ body_font })}
        />
        <Select<PageMargin>
          label="Page margins"
          value={style.page_margin}
          options={[
            ['tight',    'Tight'],
            ['normal',   'Normal'],
            ['generous', 'Generous'],
          ]}
          onChange={(page_margin) => onChange({ page_margin })}
        />
        <Select<TagStyle>
          label="Skill tags"
          value={style.tag_style}
          options={[
            ['chips',  'Chips'],
            ['inline', 'Inline list'],
          ]}
          onChange={(tag_style) => onChange({ tag_style })}
        />
        <Select<string>
          label="Item dividers"
          value={style.item_divider === false ? 'off' : (style.divider_style ?? 'line')}
          options={[
            ['line',   'Full line'],
            ['short',  'Short line'],
            ['thick',  'Thick line'],
            ['dashed', 'Dashed'],
            ['dotted', 'Dotted'],
            ['double', 'Double'],
            ['space',  'Space only'],
            ['off',    'None'],
          ]}
          onChange={(v) => onChange(v === 'off'
            ? { item_divider: false }
            : { item_divider: true, divider_style: v as DividerStyle })}
        />
        <Select<string>
          label="Item bullets"
          value={style.item_bullets ? (style.bullet_style ?? 'disc') : 'off'}
          options={[['off', 'None'], ...BULLET_STYLE_OPTIONS]}
          onChange={(v) => onChange(v === 'off'
            ? { item_bullets: false }
            : { item_bullets: true, bullet_style: v as BulletStyle })}
        />
        <Select<SummaryLayout>
          label="Summary layout"
          value={style.summary_layout ?? DEFAULT_SUMMARY_LAYOUT}
          options={SUMMARY_LAYOUT_OPTIONS}
          onChange={(summary_layout) => onChange({ summary_layout })}
        />
        <Select<FullLayout>
          label="Full-item layout"
          value={normalizeFullLayout(style.date_position)}
          options={FULL_LAYOUT_OPTIONS}
          onChange={(date_position) => onChange({ date_position })}
        />
        <Select<string>
          label="Summaries"
          value={style.tabulate ? 'on' : 'off'}
          options={[
            ['off', 'Free-flowing lines'],
            ['on',  'Aligned columns'],
          ]}
          onChange={(v) => onChange({ tabulate: v === 'on' })}
        />
        <Select<DateFormat>
          label="Date format"
          value={style.date_format ?? 'month-year'}
          options={DATE_FORMAT_OPTIONS}
          onChange={(date_format) => onChange({ date_format })}
        />
        <Select<string>
          label="Section icons"
          value={style.section_icons ? 'on' : 'off'}
          options={[
            ['off', 'Hidden'],
            ['on', 'Show before headings'],
          ]}
          onChange={(v) => onChange({ section_icons: v === 'on' })}
        />
        <div className="rv-vs-field">
          <span className="rv-vs-label">Heading colour</span>
          <div className="rv-vs-color-row">
            <input
              type="color"
              className="rv-vs-color"
              aria-label="Heading colour"
              value={style.heading_color ?? style.accent_color}
              onChange={(e) => onChange({ heading_color: e.target.value })}
            />
            <input
              type="text"
              className="rv-vs-hex"
              value={style.heading_color ?? style.accent_color}
              onChange={(e) => {
                const v = e.target.value.trim()
                if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange({ heading_color: v })
              }}
            />
          </div>
        </div>
        <div className="rv-vs-field">
          <span className="rv-vs-label">Accent colour</span>
          <div className="rv-vs-color-row">
            <input
              type="color"
              className="rv-vs-color"
              aria-label="Accent colour"
              value={style.accent_color}
              onChange={(e) => onChange({ accent_color: e.target.value })}
            />
            <input
              type="text"
              className="rv-vs-hex"
              value={style.accent_color}
              onChange={(e) => {
                const v = e.target.value.trim()
                if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange({ accent_color: v })
              }}
            />
          </div>
        </div>
      </div>
      {(() => {
        // Offer to install the chosen fonts that aren't guaranteed on the
        // machine, so Word (and the reader's copy) matches the preview.
        const g = getDefaultFonts()
        const ids = [effectiveFont(style.heading_font, g.heading), effectiveFont(style.body_font, g.body)]
        const seen = new Set<string>()
        const installs = ids
          .map((id) => fontInstallInfo(id))
          .filter((x): x is { label: string; url: string } => !!x && !seen.has(x.url) && (seen.add(x.url), true))
        if (!installs.length) return null
        return (
          <p className="rv-vs-fonthint">
            {installs.map((f) => (
              <a key={f.url} className="rv-vs-fontlink" href={f.url} target="_blank" rel="noopener noreferrer">
                <Download size={12} /> Install “{f.label}” so Word/PDF match
              </a>
            ))}
          </p>
        )
      })()}
      <button type="button" className="rv-vs-reset" onClick={resetAll}>
        <RotateCcw size={12} /> Reset to defaults
      </button>
    </>
  )
}
