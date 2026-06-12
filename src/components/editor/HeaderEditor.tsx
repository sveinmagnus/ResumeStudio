import { useStore } from '../../store/useStore'
import { DualField } from '../ui/DualField'
import { TextField } from '../ui/Fields'
import { ImageField } from '../ui/ImageField'

/**
 * Personal Details â€” the resume root's identity fields only
 * (name/contact/title/links/photo/company). The profile prose and key
 * competencies moved to their own sidebar page ("Profile & Competencies",
 * see ProfileCompetenciesEditor) â€” the old sub-tabs were a navigation
 * pattern nothing else in the app used.
 */
export function HeaderEditor() {
  const { data, updateResume } = useStore()
  const r = data.resume
  if (!r) return null

  return (
    <div className="section-pane">
      <div className="editor-block">
        <h3 className="eb-title">Identity</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <TextField label="Full name" value={r.full_name} onChange={(v) => updateResume({ full_name: v })} />
          <TextField label="Email" value={r.email} type="email" onChange={(v) => updateResume({ email: v })} />
          <TextField label="Phone" value={r.phone || ''} onChange={(v) => updateResume({ phone: v })} />
          <TextField label="Date of birth" value={r.date_of_birth || ''} type="date" onChange={(v) => updateResume({ date_of_birth: v })} />
        </div>
      </div>

      <div className="editor-block">
        <h3 className="eb-title">Professional</h3>
        <DualField label="Title" value={r.title} onChange={(v) => updateResume({ title: v })} placeholder="e.g. Technology Architect" />
        <DualField label="Nationality" value={r.nationality} onChange={(v) => updateResume({ nationality: v })} />
        <DualField label="Place of residence" value={r.place_of_residence} onChange={(v) => updateResume({ place_of_residence: v })} />
      </div>

      <div className="editor-block">
        <h3 className="eb-title">Links</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <TextField label="LinkedIn URL" value={r.linkedin_url || ''} onChange={(v) => updateResume({ linkedin_url: v })} />
          <TextField label="Website" value={r.website_url || ''} onChange={(v) => updateResume({ website_url: v })} />
          <TextField label="Twitter / X" value={r.twitter || ''} onChange={(v) => updateResume({ twitter: v })} />
          <TextField label="Profile image URL" value={r.profile_image_url || ''} onChange={(v) => updateResume({ profile_image_url: v })} />
        </div>
      </div>

      <div className="editor-block">
        <h3 className="eb-title">Photo &amp; company</h3>
        <p className="eb-desc">
          Upload a profile photo and your consultancy logo here. Each Resume View
          controls whether and where they appear, and can override them per view.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
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
        <TextField
          label="Company name"
          value={r.company_name || ''}
          onChange={(v) => updateResume({ company_name: v })}
          placeholder="e.g. Cartavio AS"
        />
      </div>

      <style>{`
        .eb-desc { font-size: 13px; color: var(--ink-soft); line-height: 1.55; margin-bottom: 14px; }
      `}</style>
    </div>
  )
}