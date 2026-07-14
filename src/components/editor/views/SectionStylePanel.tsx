import type { SectionStyle, SectionDetail, Density, TagStyle, DividerStyle, SummaryLayout, FullLayout, DateFormat, LocalizedString, SortMode } from '../../../types'
import { Sliders, RotateCcw } from 'lucide-react'
import { availableSortModes, SORT_LABELS } from '../../../lib/sectionSort'
import { DualField } from '../../ui/DualField'

// Item-layout option lists, shared with the view-wide controls. "Org" is the
// item's organisation/role descriptor; "Date" its date or start–end range.
// Listed alphabetically by slot order, so Date → Title → Org (the default) leads.
export const SUMMARY_LAYOUT_OPTIONS: Array<[SummaryLayout, string]> = [
  ['date-title-org', 'Date → Title → Org'],
  ['date-org-title', 'Date → Org → Title'],
  ['org-title-date', 'Org → Title → Date'],
  ['org-date-title', 'Org → Date → Title'],
  ['title-org-date', 'Title → Org → Date'],
  ['title-date-org', 'Title → Date → Org'],
]
// Full-item layout: title-first vs. details-line-first, each with the date
// before or after the organisation. The description always follows the head.
export const FULL_LAYOUT_OPTIONS: Array<[FullLayout, string]> = [
  ['title-org-date', 'Title first (org, date)'],
  ['title-date-org', 'Title first (date, org)'],
  ['lead-org-date',  'Date/org first (org, date)'],
  ['lead-date-org',  'Date/org first (date, org)'],
]
export const DATE_FORMAT_OPTIONS: Array<[DateFormat, string]> = [
  ['month-year',     'Month Year (Mar 2021)'],
  ['year-month',     'Year Month (2021 Mar)'],
  ['month-year-num', 'Month/Year numeric (03/2021)'],
  ['year-month-num', 'Year/Month numeric (2021/03)'],
  ['year-only',      'Year only (2021)'],
]

// Sections whose items actually render skill tags — the only place a per-section
// "Tag style" override is meaningful (see lib/sectionCatalog.ts: projects,
// key_qualifications and the Skills Showcase set `tags`).
const TAG_SECTIONS = new Set(['projects', 'key_qualifications', 'technology_categories'])

const anyLocale = (v: LocalizedString): boolean => Object.values(v).some((x) => (x ?? '').trim() !== '')

// ─── Detail toggle ──────────────────────────────────────────────────────────

/**
 * The section render mode as one 4-way control. 'tabulated' and 'summary' both
 * map to `detail:'summary'` — 'tabulated' additionally sets `style.tabulate`.
 * (The store keeps detail + tabulate separate; this is the UI presentation.)
 */
export type SectionMode = 'off' | 'tabulated' | 'summary' | 'full'
const MODE_OPTIONS: Array<[SectionMode, string]> = [
  ['off', 'Off'], ['tabulated', 'Tabulated'], ['summary', 'Summary'], ['full', 'Full'],
]

export function DetailToggle({ value, onChange }: { value: SectionMode; onChange: (m: SectionMode) => void }) {
  return (
    <div className="rv-detail-toggle" role="radiogroup" aria-label="Section detail level">
      {MODE_OPTIONS.map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          className={`rv-detail-opt ${value === mode ? 'is-active' : ''}`}
          onClick={() => onChange(mode)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ─── Per-section style panel (collapsed by default) ─────────────────────────

interface SectionStylePanelProps {
  sectionKey: string
  detail: SectionDetail
  style: SectionStyle | undefined
  onChange: (patch: SectionStyle) => void
  onReset: () => void
  hasStyle: boolean
  /** This view's item sort for the section (default 'custom'). */
  sort: SortMode
  onSortChange: (mode: SortMode) => void
}

export function SectionStylePanel({ sectionKey, detail, style, onChange, onReset, hasStyle, sort, onSortChange }: SectionStylePanelProps) {
  const s: SectionStyle = style ?? {}
  const showTag = TAG_SECTIONS.has(sectionKey)
  const isSummary = detail === 'summary'
  // Tabulated is a summary variant; the short-description line is a plain-summary
  // feature (it's what separates the two modes), so it's hidden when tabulated.
  const isPlainSummary = isSummary && !s.tabulate
  const sortModes = availableSortModes(sectionKey)
  // Rendered inline whenever its section row is expanded (the row is the
  // collapse unit now), so the overrides are always visible without a second
  // click — they're almost always what the user came to adjust.
  return (
    <div className="rv-secstyle">
      <div className="rv-secstyle-header">
        <Sliders size={11} /> Style overrides
        {hasStyle && <span className="rv-secstyle-badge">custom</span>}
        {hasStyle && (
          <button
            type="button"
            className="rv-secstyle-reset"
            onClick={onReset}
            title="Use view defaults for this section"
          >
            <RotateCcw size={10} /> Reset
          </button>
        )}
      </div>
      <div className="rv-secstyle-body">
        {/* Toggles on the left — checkbox before its label so what's on is clear.
            The date format lives here too (under Hide dates). */}
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
          <div className="rv-sel">
            <span>Date format</span>
            <select
              aria-label="Section date format"
              value={s.date_format ?? ''}
              onChange={(e) => onChange({ date_format: (e.target.value || undefined) as DateFormat | undefined })}
            >
              <option value="">— view default —</option>
              {DATE_FORMAT_OPTIONS.map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>
        </div>
        {/* Dropdowns on the right. Labelled by their visible span (not a wrapping
            <label>) so they don't collide with the identically-named view-wide
            controls in automated/AT queries. */}
        <div className="rv-secstyle-selects">
          <div className="rv-sel">
            <span>Sort items</span>
            <select
              aria-label="Section item sort"
              value={sort}
              onChange={(e) => onSortChange(e.target.value as SortMode)}
            >
              {sortModes.map((m) => (
                <option key={m} value={m}>{SORT_LABELS[m]}</option>
              ))}
            </select>
          </div>
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
          {/* Item layout — its options depend on the section's detail level:
              summary sections reorder the Title/Org/Date slots; full sections
              choose where the date/details block sits. */}
          {isSummary ? (
            <div className="rv-sel">
              <span>Item layout</span>
              <select
                aria-label="Section summary layout"
                value={s.summary_layout ?? ''}
                onChange={(e) => onChange({ summary_layout: (e.target.value || undefined) as SummaryLayout | undefined })}
              >
                <option value="">— view default —</option>
                {SUMMARY_LAYOUT_OPTIONS.map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="rv-sel">
              <span>Item layout</span>
              <select
                aria-label="Section item layout"
                value={s.date_position ?? ''}
                onChange={(e) => onChange({ date_position: (e.target.value || undefined) as FullLayout | undefined })}
              >
                <option value="">— view default —</option>
                {FULL_LAYOUT_OPTIONS.map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>
          )}
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
          {/* Plain-summary only: where the item's short description sits. */}
          {isPlainSummary && (
            <div className="rv-sel">
              <span>Short description</span>
              <select
                aria-label="Section short-description placement"
                value={s.short_desc_line ?? ''}
                onChange={(e) => onChange({ short_desc_line: (e.target.value || undefined) as 'inline' | 'below' | undefined })}
              >
                <option value="">— view default (below) —</option>
                <option value="below">On its own line below</option>
                <option value="inline">Same line as the core info</option>
              </select>
            </div>
          )}
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
    </div>
  )
}
