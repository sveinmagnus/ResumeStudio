import { useState } from 'react'
import { ImageField } from '../../ui/ImageField'
import type {
  ViewHeaderConfig, HeaderField, HeaderTextStyle,
  PhotoPlacement, ProfileImageShape, LogoPlacement,
} from '../../../types'
import { ChevronUp, ChevronDown, Loader2, Link2 } from 'lucide-react'
import { Select } from './Select'
import { imageUrlToResizedDataUrl } from '../../../lib/image'

// ─── Header field display labels ──────────────────────────────────────────────
const HEADER_FIELD_LABELS: Record<HeaderField['key'], string> = {
  phone: 'Phone',
  email: 'Email',
  location: 'Location',
  nationality: 'Nationality',
  date_of_birth: 'Date of birth',
  linkedin: 'LinkedIn',
  website: 'Website',
  twitter: 'Twitter / X',
  languages: 'Languages summary',
}

// ─── View header controls ────────────────────────────────────────────────────

export function ViewHeaderControls({
  header, primaryLocale, masterPhoto, masterLogo, profileImageUrl, onChange,
}: {
  header: ViewHeaderConfig
  primaryLocale: string
  masterPhoto: string | null
  masterLogo: string | null
  /** The resume's external profile image URL, importable into this view's photo. */
  profileImageUrl: string | null
  onChange: (patch: Partial<ViewHeaderConfig>) => void
}) {
  const fields = [...header.fields].sort((a, b) => a.sort_order - b.sort_order)

  // Import the external profile image URL into this view's photo_override as an
  // embedded (data URL) image, so it renders offline everywhere (PDF + DOCX).
  const [urlBusy, setUrlBusy] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const useProfileImageUrl = async () => {
    if (!profileImageUrl || urlBusy) return
    setUrlBusy(true)
    setUrlError(null)
    try {
      const dataUrl = await imageUrlToResizedDataUrl(profileImageUrl, { format: 'jpeg', maxDim: 600 })
      onChange({ photo_override: dataUrl })
    } catch (e) {
      setUrlError(e instanceof Error ? e.message : 'Could not import the image.')
    } finally {
      setUrlBusy(false)
    }
  }

  const setField = (key: HeaderField['key'], patch: Partial<HeaderField>) => {
    onChange({ fields: header.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) })
  }
  const setLabel = (key: HeaderField['key'], text: string) => {
    const f = header.fields.find((x) => x.key === key)
    if (!f) return
    const label = { ...f.label }
    if (text) label[primaryLocale] = text
    else delete label[primaryLocale]
    setField(key, { label })
  }
  const moveField = (key: HeaderField['key'], dir: 'up' | 'down') => {
    const sorted = [...header.fields].sort((a, b) => a.sort_order - b.sort_order)
    const idx = sorted.findIndex((f) => f.key === key)
    const swap = dir === 'up' ? idx - 1 : idx + 1
    if (idx === -1 || swap < 0 || swap >= sorted.length) return
    ;[sorted[idx], sorted[swap]] = [sorted[swap], sorted[idx]]
    onChange({ fields: sorted.map((f, i) => ({ ...f, sort_order: i })) })
  }

  return (
    <div className="rv-hdr">
      {/* Typography */}
      <div className="rv-hdr-sub">Typography</div>
      <div className="rv-hdr-type-grid">
        <HeaderTextStyleControl
          label="Name" value={header.name_style} autoLabel="Auto (large)"
          onChange={(name_style) => onChange({ name_style })}
        />
        <HeaderTextStyleControl
          label="Title" value={header.title_style} autoLabel="Auto"
          onChange={(title_style) => onChange({ title_style })}
        />
      </div>

      {/* Detail rows */}
      <div className="rv-hdr-sub">
        Detail rows
        <label className="rv-hdr-sep">
          Separator
          <input
            className="rv-hdr-sep-input"
            value={header.separator}
            onChange={(e) => onChange({ separator: e.target.value })}
            maxLength={5}
          />
        </label>
      </div>
      <p className="rv-hdr-note">
        Toggle which rows show, edit the descriptor text (in your primary
        language), and choose whether each shares the previous row's line.
      </p>
      <div className="rv-hdr-fields">
        {fields.map((f, idx) => (
          <div key={f.key} className={`rv-hdr-field ${f.show ? '' : 'is-off'}`}>
            <div className="rv-hdr-ord">
              <button className="rv-ord-btn" onClick={() => moveField(f.key, 'up')} disabled={idx === 0} aria-label="Move up">
                <ChevronUp size={13} />
              </button>
              <button className="rv-ord-btn" onClick={() => moveField(f.key, 'down')} disabled={idx === fields.length - 1} aria-label="Move down">
                <ChevronDown size={13} />
              </button>
            </div>
            <label className="rv-hdr-show" title="Show this row">
              <input type="checkbox" checked={f.show} onChange={(e) => setField(f.key, { show: e.target.checked })} />
            </label>
            <span className="rv-hdr-fname">{HEADER_FIELD_LABELS[f.key]}</span>
            <input
              className="rv-hdr-desc"
              value={f.label[primaryLocale] ?? ''}
              placeholder="descriptor…"
              disabled={!f.show}
              onChange={(e) => setLabel(f.key, e.target.value)}
            />
            <label className="rv-hdr-sameline" title="Render on the same line as the previous row">
              <input
                type="checkbox"
                checked={f.same_line}
                disabled={!f.show || idx === 0}
                onChange={(e) => setField(f.key, { same_line: e.target.checked })}
              />
              same line
            </label>
          </div>
        ))}
      </div>

      {/* Photo */}
      <div className="rv-hdr-sub">Profile photo</div>
      <div className="rv-hdr-img-grid">
        <Select<PhotoPlacement>
          label="Placement"
          value={header.photo_placement}
          options={[
            ['none', 'Hidden'],
            ['left', 'Left of details'],
            ['right', 'Right of details'],
            ['above', 'Above details'],
            ['below', 'Below details'],
          ]}
          onChange={(photo_placement) => onChange({ photo_placement })}
        />
        <Select<ProfileImageShape>
          label="Shape"
          value={header.photo_shape}
          options={[
            ['square',  'Square (original)'],
            ['rounded', 'Square, rounded corners'],
            ['circle',  'Circular'],
          ]}
          onChange={(photo_shape) => onChange({ photo_shape })}
        />
        <div className="rv-hdr-override">
          <ImageField
            label="Photo override (this view)"
            value={header.photo_override}
            onChange={(photo_override) => onChange({ photo_override })}
            format="jpeg"
            maxDim={600}
            shape="square"
            crop
            hint={masterPhoto ? 'Leave empty to use the master photo.' : 'No master photo set — upload one here or in Personal Details.'}
          />
          {profileImageUrl && (
            <div className="rv-hdr-url">
              <button type="button" className="rv-hdr-url-btn" onClick={() => void useProfileImageUrl()} disabled={urlBusy}>
                {urlBusy ? <Loader2 size={12} className="rv-spin" /> : <Link2 size={12} />}
                {urlBusy ? 'Fetching…' : 'Use profile image URL'}
              </button>
              <span className="rv-hdr-url-hint">Downloads and embeds the resume’s Profile image URL as this view’s photo.</span>
              {urlError && <span className="rv-hdr-url-err" role="alert">{urlError}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Logo */}
      <div className="rv-hdr-sub">Company logo</div>
      <div className="rv-hdr-img-grid">
        <Select<LogoPlacement>
          label="Placement"
          value={header.logo_placement}
          options={[
            ['none', 'Hidden'],
            ['left', 'Top left'],
            ['center', 'Top center'],
            ['right', 'Top right'],
          ]}
          onChange={(logo_placement) => onChange({ logo_placement })}
        />
        <div className="rv-hdr-override">
          <ImageField
            label="Logo override (this view)"
            value={header.logo_override}
            onChange={(logo_override) => onChange({ logo_override })}
            format="png"
            maxDim={600}
            shape="wide"
            hint={masterLogo ? 'Leave empty to use the master logo.' : 'No master logo set — upload one here or in Personal Details.'}
          />
        </div>
      </div>
    </div>
  )
}

function HeaderTextStyleControl({
  label, value, autoLabel, onChange,
}: {
  label: string
  value: HeaderTextStyle
  autoLabel: string
  onChange: (v: HeaderTextStyle) => void
}) {
  return (
    <div className="rv-hdr-type">
      <span className="rv-vs-label">{label}</span>
      <div className="rv-hdr-type-row">
        <select
          className="rv-vs-select"
          value={value.font}
          onChange={(e) => onChange({ ...value, font: e.target.value as HeaderTextStyle['font'] })}
        >
          <option value="condensed">Condensed</option>
          <option value="sans">Sans (Ubuntu)</option>
          <option value="serif">Serif (Georgia)</option>
          <option value="body">Body font</option>
        </select>
        <input
          className="rv-hdr-size"
          type="number"
          min={6} max={72}
          value={value.size_pt ?? ''}
          placeholder={autoLabel}
          title="Font size in points (blank = automatic)"
          onChange={(e) => onChange({ ...value, size_pt: e.target.value ? parseInt(e.target.value) : null })}
        />
        <span className="rv-hdr-pt">pt</span>
      </div>
    </div>
  )
}
