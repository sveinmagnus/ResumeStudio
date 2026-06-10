import { DualField } from '../../ui/DualField'
import type { ViewFooterConfig, FooterSeparator, CopyrightHolder } from '../../../types'
import { Select } from './Select'

// ─── View footer controls ────────────────────────────────────────────────────

export function ViewFooterControls({
  footer, hasCompany, onChange,
}: {
  footer: ViewFooterConfig
  hasCompany: boolean
  onChange: (patch: Partial<ViewFooterConfig>) => void
}) {
  return (
    <>
      <div className="rv-vs-grid">
        <Select<FooterSeparator>
          label="Closing separator"
          value={footer.separator}
          options={[
            ['none', 'None'],
            ['line', 'Thin line'],
            ['thick', 'Thick line'],
            ['double', 'Double line'],
            ['dotted', 'Dotted'],
            ['dashed', 'Dashed'],
          ]}
          onChange={(separator) => onChange({ separator })}
        />
        <Select<CopyrightHolder>
          label="Copyright statement"
          value={footer.copyright}
          options={[
            ['none', 'None'],
            ['person', 'Your name'],
            ['company', hasCompany ? 'Company name' : 'Company (not set)'],
            ['custom', 'Custom…'],
          ]}
          onChange={(copyright) => onChange({ copyright })}
        />
      </div>
      {footer.copyright === 'company' && !hasCompany && (
        <p className="rv-hdr-note" style={{ color: '#b45309' }}>
          No company name is set in Personal Details — the copyright line will be
          omitted until you add one.
        </p>
      )}
      {footer.copyright === 'custom' && (
        <div style={{ marginTop: 12 }}>
          <DualField
            label="Custom copyright holder (this view)"
            value={footer.copyright_custom}
            onChange={(copyright_custom) => onChange({ copyright_custom })}
            placeholder="e.g. Another Consultancy AS"
          />
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <DualField
          label="Footer note (optional)"
          value={footer.note}
          onChange={(note) => onChange({ note })}
          placeholder="e.g. Confidential — do not distribute"
        />
      </div>
    </>
  )
}
