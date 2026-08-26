import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { DualField } from '../ui/DualField'
import { TextField } from '../ui/Fields'
import { ImageField } from '../ui/ImageField'
import { socialSiteName } from '../../lib/socialSite'

/**
 * Personal Details — the resume root's identity fields only
 * (name/contact/links/photo/company). The profile prose and key competencies
 * are their own sidebar sections ("Profile" and "Key competencies") — the old
 * Personal Details sub-tabs were a navigation pattern nothing else in the app
 * used.
 *
 * Layout: Identity (the near-immutable name + birth date as locked displays,
 * then the localized origin fields), Contact details & online profiles, then
 * Photo & company. The name and birth date are written once and then shown as
 * display text with a pencil — the ViewEditor's name/purpose pattern — because
 * an always-editable input invites the accidental edit these two never need.
 */
export function HeaderEditor() {
  const { data, updateResume } = useStore()
  const r = data.resume
  if (!r) return null

  return (
    <div className="section-pane">
      <div className="editor-block">
        <h3 className="editor-block-title">Identity</h3>
        <div className="he-grid">
          <LockedField
            label="Full name"
            value={r.full_name}
            onChange={(v) => updateResume({ full_name: v })}
            placeholder="e.g. Kari Nordmann"
          />
          <LockedField
            label="Date of birth"
            value={r.date_of_birth || ''}
            onChange={(v) => updateResume({ date_of_birth: v || null })}
            type="date"
          />
        </div>
        <DualField label="Nationality" value={r.nationality} onChange={(v) => updateResume({ nationality: v })} />
        <DualField label="Place of residence" value={r.place_of_residence} onChange={(v) => updateResume({ place_of_residence: v })} />
      </div>

      <div className="editor-block">
        <h3 className="editor-block-title">Contact details and online profiles</h3>
        <div className="he-grid">
          <TextField label="Phone" value={r.phone || ''} onChange={(v) => updateResume({ phone: v })} />
          <TextField label="Email" value={r.email} type="email" onChange={(v) => updateResume({ email: v })} />
          <TextField label="Business website" value={r.website_url || ''} onChange={(v) => updateResume({ website_url: v })} />
          <TextField label="Personal website" value={r.personal_website_url || ''} onChange={(v) => updateResume({ personal_website_url: v || null })} />
          <TextField label="LinkedIn URL" value={r.linkedin_url || ''} onChange={(v) => updateResume({ linkedin_url: v })} />
          {/* Stored in the historical `twitter` slot — see the Resume type. */}
          <div>
            <TextField label="Other social media URL" value={r.twitter || ''} onChange={(v) => updateResume({ twitter: v })} placeholder="Mastodon, Bluesky, GitHub, X…" />
            {socialSiteName(r.twitter ?? '') && (
              <p className="he-social-hint">Shown in exports as: <strong>{socialSiteName(r.twitter ?? '')}</strong></p>
            )}
          </div>
        </div>
      </div>

      <div className="editor-block">
        <h3 className="editor-block-title">Photo &amp; company</h3>
        <p className="eb-desc">
          Upload a profile photo and your consultancy logo here. Each Resume View
          controls whether and where they appear, and can override them per view.
        </p>
        <div className="he-grid" style={{ marginBottom: 14 }}>
          <ImageField
            label="Profile photo"
            value={r.profile_photo ?? null}
            onChange={(v) => updateResume({ profile_photo: v })}
            format="jpeg"
            maxDim={600}
            shape="square"
            crop
            hint="Pick a file and pan / zoom into the square crop. Each Resume View picks how it's masked (square, rounded, or circular)."
          />
          <ImageField
            label="Company logo"
            value={r.company_logo ?? null}
            onChange={(v) => updateResume({ company_logo: v })}
            format="png"
            maxDim={600}
            shape="wide"
            hint="Transparent PNG recommended."
          />
        </div>
        <div className="he-grid">
          <TextField
            label="Company name"
            value={r.company_name || ''}
            onChange={(v) => updateResume({ company_name: v })}
            placeholder="e.g. Cartavio AS"
          />
          <TextField
            label="Profile image URL"
            value={r.profile_image_url || ''}
            onChange={(v) => updateResume({ profile_image_url: v })}
            placeholder="External photo link — a view can import it as its photo"
          />
        </div>
      </div>

      <style>{`
        .he-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
        .eb-desc { font-size: 13px; color: var(--ink-soft); line-height: 1.55; margin-bottom: 14px; }
        .he-social-hint { font-size: 12px; color: var(--ink-faint); margin-top: 4px; }
      `}</style>
    </div>
  )
}

/**
 * A write-once identity field: empty shows the input; filled shows the value as
 * a bold header-like display (the view-title pattern) with a pencil to reopen
 * it. Editing closes on blur or Enter/Escape.
 */
function LockedField({ label, value, onChange, type = 'text', placeholder }: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'date'
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const open = editing || !value.trim()

  if (open) {
    return (
      <div>
        <TextField
          label={label}
          value={value}
          type={type}
          onChange={onChange}
          placeholder={placeholder}
          onBlur={() => setEditing(false)}
        />
      </div>
    )
  }
  return (
    <div className="lf-wrap">
      <span className="lf-label">{label}</span>
      <div className="lf-row">
        <span className="lf-value">{type === 'date' ? fmtDateValue(value) : value}</span>
        <button
          type="button"
          className="lf-edit"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${label.toLowerCase()}`}
          title={`Edit ${label.toLowerCase()}`}
        >
          <Pencil size={14} />
        </button>
      </div>
      <style>{`
        .lf-wrap { display: flex; flex-direction: column; }
        .lf-label {
          font-size: 11px; font-weight: 600; letter-spacing: .08em;
          text-transform: uppercase; color: var(--ink-faint); margin-bottom: 7px;
        }
        .lf-row { display: flex; align-items: center; gap: 8px; min-height: 38px; }
        .lf-value { font-size: 20px; font-weight: 600; color: var(--ink); }
        .lf-edit {
          width: 28px; height: 28px; display: grid; place-items: center;
          border-radius: var(--r-sm); color: var(--ink-faint);
          transition: color .12s, background .12s;
        }
        .lf-edit:hover { background: var(--accent-wash); color: var(--accent); }
      `}</style>
    </div>
  )
}

/** A yyyy-mm-dd input value as a readable date; anything else verbatim. */
function fmtDateValue(v: string): string {
  const t = Date.parse(v)
  if (Number.isNaN(t)) return v
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}
