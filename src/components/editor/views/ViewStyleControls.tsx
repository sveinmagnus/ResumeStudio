import { DEFAULT_VIEW_STYLE, DEFAULT_SUMMARY_LAYOUT, normalizeFullLayout } from '../../../lib/viewStyle'
import type { ViewStyle, Density, BodySize, HeadingFont, PageMargin, TagStyle, DividerStyle, SummaryLayout, FullLayout, DateFormat } from '../../../types'
import { RotateCcw } from 'lucide-react'
import { Select } from './Select'
import { SUMMARY_LAYOUT_OPTIONS, FULL_LAYOUT_OPTIONS, DATE_FORMAT_OPTIONS } from './SectionStylePanel'

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
        <Select<HeadingFont>
          label="Heading font"
          value={style.heading_font}
          options={[
            ['condensed', 'Condensed (Cartavio)'],
            ['sans',      'Sans (Ubuntu)'],
            ['serif',     'Serif (Georgia)'],
          ]}
          onChange={(heading_font) => onChange({ heading_font })}
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
        <div className="rv-vs-field">
          <span className="rv-vs-label">Accent colour</span>
          <div className="rv-vs-color-row">
            <input
              type="color"
              className="rv-vs-color"
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
      <button type="button" className="rv-vs-reset" onClick={resetAll}>
        <RotateCcw size={12} /> Reset to defaults
      </button>
    </>
  )
}
