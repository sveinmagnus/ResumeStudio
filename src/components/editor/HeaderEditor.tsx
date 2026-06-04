import { useStore } from '../../store/useStore'
import { DualField } from '../ui/DualField'
import { TextField } from '../ui/Fields'
import { ImageField } from '../ui/ImageField'
import { ProfileEditor, KeyCompetenciesEditor } from './SimpleEditors'
import { User, FileText, ListChecks } from 'lucide-react'

/**
 * Personal Details host. Three sub-tabs:
 *   - Identity: the resume root (name/contact/title/links/photo/company).
 *   - Profile: the key_qualifications blocks (label/tag-line/summary/key points).
 *   - Key competencies: the key_competencies entries (title + description).
 *
 * Which tab is active mirrors the store's `activeSection`:
 *   - 'header'             → Identity
 *   - 'key_qualifications' → Profile
 *   - 'key_competencies'   → Key competencies
 *
 * The Overview's "missing field" drill-down navigates to
 * activeSection='key_qualifications' for KQ fields; we honour that here so a
 * click on a missing KQ field still lands on the Profile content.
 */
export function HeaderEditor() {
  const { data, updateResume, activeSection, setActiveSection } = useStore()
  const r = data.resume
  if (!r) return null

  const tab = activeSection === 'key_qualifications' ? 'profile'
    : activeSection === 'key_competencies' ? 'competencies'
    : 'identity'

  return (
    <div className="section-pane">
      <div className="hd-tabs" role="tablist" aria-label="Personal Details tabs">
        <button
          role="tab"
          aria-selected={tab === 'identity'}
          className={`hd-tab ${tab === 'identity' ? 'is-active' : ''}`}
          onClick={() => setActiveSection('header')}
        >
          <User size={14} /> Identity
        </button>
        <button
          role="tab"
          aria-selected={tab === 'profile'}
          className={`hd-tab ${tab === 'profile' ? 'is-active' : ''}`}
          onClick={() => setActiveSection('key_qualifications')}
        >
          <FileText size={14} /> Profile &amp; summary
        </button>
        <button
          role="tab"
          aria-selected={tab === 'competencies'}
          className={`hd-tab ${tab === 'competencies' ? 'is-active' : ''}`}
          onClick={() => setActiveSection('key_competencies')}
        >
          <ListChecks size={14} /> Key competencies
        </button>
      </div>

      {tab === 'competencies' ? (
        <KeyCompetenciesEditor />
      ) : tab === 'identity' ? (
        <>
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
                hint="Square crop works best. Stored in the resume; scaled down automatically."
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
        </>
      ) : (
        <ProfileEditor />
      )}

      <style>{`
        .hd-tabs {
          display: flex; gap: 4px; margin-bottom: 22px;
          border-bottom: 1px solid var(--line);
        }
        .hd-tab {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 9px 14px; font-size: 13px; font-weight: 600;
          color: var(--ink-faint); border-radius: var(--r-sm) var(--r-sm) 0 0;
          border-bottom: 2px solid transparent; transition: color .15s, border-color .15s;
          margin-bottom: -1px;
        }
        .hd-tab:hover { color: var(--accent); }
        .hd-tab.is-active { color: var(--accent); border-bottom-color: var(--accent); }
        .eb-desc { font-size: 13px; color: var(--ink-soft); line-height: 1.55; margin-bottom: 14px; }
      `}</style>
    </div>
  )
}
