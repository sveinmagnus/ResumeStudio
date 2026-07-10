import { useState, useId } from 'react'
import { useStore, newId } from '../../store/useStore'
import { useSortedItems } from '../../store/useSortedItems'
import { DualField } from '../ui/DualField'
import { RichField } from '../ui/RichField'
import { TextField, DateField, TagField } from '../ui/Fields'
import { EditorCard, FieldRow } from '../ui/EditorCard'
import { SortableList } from '../ui/SortableList'
import { SortBar } from '../ui/SortBar'
import { SectionIntro } from '../ui/SectionIntro'
import { Autocomplete } from '../ui/Autocomplete'
import { TranslationPopover } from '../ui/TranslationPopover'
import { resolve, fmtRange, fmtDate } from '../../lib/locales'
import { richToPlain } from '../../lib/richText'
import { RELATIONSHIP_OPTIONS, matchRelationshipKey, relationshipLabels } from '../../lib/recommendationRelationships'
import { PUBLICATION_TYPES } from '../../lib/publicationTypes'
import { POSITION_TYPES, positionTypeLabel } from '../../lib/positionTypes'
import type {
  WorkExperience, Education, Course, Certification, Position,
  Presentation, HonorAward, Publication, SpokenLanguage, KeyQualification,
  KeyCompetency, Recommendation, Role, LocalizedString,
} from '../../types'
import { X } from 'lucide-react'

// ── Employment ────────────────────────────────────────────────────────────────

export function WorkEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = useSortedItems('work_experiences')
  const add = () => {
    const w: WorkExperience = {
      id: newId(), resume_id: data.resume!.id, employer: {}, role_title: {}, description: {},
      long_description: {}, employment_type: null, company_size: null, company_url: null,
      start: null, end: null, role_ids: [], skill_tags: [], sort_order: items.length, starred: false, disabled: false, internal_notes: null,
    }
    addItem('work_experiences', w)
  }
  return (
    <div className="section-pane">
      <SectionIntro>
        Your permanent, contract, and freelance positions. Individual client
        engagements go under Projects; board and volunteer work under Other roles.
      </SectionIntro>
      <SortBar section="work_experiences" count={items.length} />
      <SortableList section="work_experiences" ids={items.map((x) => x.id)} addLabel="Add employment" onAdd={add}>
      {items.map((w) => (
        <EditorCard key={w.id} section="work_experiences" id={w.id}
          title={resolve(w.employer, primaryLocale)} subtitle={resolve(w.role_title, primaryLocale)}
          meta={fmtRange(w.start, w.end)} preview={richToPlain(resolve(w.long_description, primaryLocale))}
          starred={w.starred} disabled={w.disabled}>
          <DualField label="Employer" value={w.employer} onChange={(v) => updateItem('work_experiences', w.id, { employer: v })} />
          <DualField label="Position title" value={w.role_title} onChange={(v) => updateItem('work_experiences', w.id, { role_title: v })} placeholder="Your title as held at this company" />
          <EmploymentRoleTypes work={w} />
          <RichField label="Description" value={w.long_description} onChange={(v) => updateItem('work_experiences', w.id, { long_description: v })} />
          <FieldRow>
            <DateField label="Start" value={w.start} onChange={(v) => updateItem('work_experiences', w.id, { start: v })} />
            <DateField label="End" value={w.end} onChange={(v) => updateItem('work_experiences', w.id, { end: v })} allowOngoing />
          </FieldRow>
          <FieldRow>
            <label className="pf-wrap">
              <span className="pf-label">Employment type</span>
              <select className="pf-input" value={w.employment_type || ''}
                onChange={(e) => updateItem('work_experiences', w.id, { employment_type: (e.target.value || null) as WorkExperience['employment_type'] })}>
                <option value="">—</option>
                <option value="permanent">Permanent</option>
                <option value="contract">Contract</option>
                <option value="freelance">Freelance</option>
                <option value="part_time">Part-time</option>
                <option value="internship">Internship</option>
              </select>
            </label>
            <TextField label="Company URL" value={w.company_url || ''} onChange={(v) => updateItem('work_experiences', w.id, { company_url: v })} />
          </FieldRow>
          <FieldRow>
            <TextField label="Headcount — local company" value={w.company_size_local || ''} onChange={(v) => updateItem('work_experiences', w.id, { company_size_local: v })} placeholder="e.g. ~50" />
            <TextField label="National / regional division" value={w.company_size_national || ''} onChange={(v) => updateItem('work_experiences', w.id, { company_size_national: v })} placeholder="e.g. 1,200" />
            <TextField label="Global group" value={w.company_size_global || ''} onChange={(v) => updateItem('work_experiences', w.id, { company_size_global: v })} placeholder="e.g. 40,000" />
          </FieldRow>
        </EditorCard>
      ))}
      </SortableList>
    </div>
  )
}

/**
 * Links a work_experience to one or MORE registry Roles indicating the general
 * ROLE TYPE(S) held (e.g. "Architect", "Team Lead") — independent of the
 * company-specific `role_title`. Mirrors the project.roles[] chip pattern so
 * role-registry merges rewrite these links and the role-usage panel lists
 * employments. Picking or creating a role never touches `role_title`.
 */
function EmploymentRoleTypes({ work }: { work: WorkExperience }) {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const linked = work.role_ids
    .map((id) => data.roles.find((r) => r.id === id))
    .filter((r): r is Role => !!r)
  const editing = editingId ? data.roles.find((r) => r.id === editingId) ?? null : null

  const add = (roleId: string) => {
    if (work.role_ids.includes(roleId)) return
    updateItem('work_experiences', work.id, { role_ids: [...work.role_ids, roleId] })
  }
  const remove = (roleId: string) =>
    updateItem('work_experiences', work.id, { role_ids: work.role_ids.filter((id) => id !== roleId) })
  const createAndAdd = (text: string) => {
    const r: Role = {
      id: newId(), resume_id: data.resume!.id,
      name: { [primaryLocale]: text },
      years_of_experience: 0, years_of_experience_offset: 0,
      starred: false, sort_order: data.roles.length, disabled: false,
    }
    // open:false — creating the role must not steal focus from (and collapse)
    // this employment card. Link the new id immediately (title untouched).
    addItem('roles', r, { open: false })
    updateItem('work_experiences', work.id, { role_ids: [...work.role_ids, r.id] })
  }

  return (
    <div className="erl-wrap">
      <label className="erl-label">Role type(s) <span className="erl-hint">— the general role held, for summarising experience across positions (independent of the title above)</span></label>
      {linked.length > 0 && (
        <div className="erl-chips">
          {linked.map((r) => (
            <span key={r.id} className="erl-chip">
              <button type="button" className="erl-chip-name" onClick={() => setEditingId((o) => (o === r.id ? null : r.id))} title="Edit translation in both languages">
                {resolve(r.name, primaryLocale) || '(unnamed role)'}
              </button>
              <button type="button" className="erl-chip-x" onClick={() => remove(r.id)} aria-label={`Remove ${resolve(r.name, primaryLocale) || 'role'}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <Autocomplete
        options={data.roles
          .filter((r) => !r.disabled && !work.role_ids.includes(r.id))
          .map((r) => ({ id: r.id, label: resolve(r.name, primaryLocale) || '(unnamed)' }))}
        onPick={add}
        onAddNew={createAndAdd}
        addLabel="role type"
        placeholder="Add a role type from the registry…"
      />
      {editing && (
        <TranslationPopover
          title={`Edit “${resolve(editing.name, primaryLocale) || 'role'}” translation`}
          fieldLabel="Role name"
          value={editing.name}
          footnote="Changes the registry — all references update."
          onClose={() => setEditingId(null)}
          onChange={(name) => updateItem('roles', editing.id, { name })}
        />
      )}
      <style>{`
        .erl-wrap { margin-bottom: 18px; position: relative; }
        .erl-label {
          display: block; font-size: 11px; font-weight: 600; letter-spacing: .08em;
          text-transform: uppercase; color: var(--ink-faint); margin-bottom: 7px;
        }
        .erl-hint { font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--ink-faint); margin-left: 2px; }
        .erl-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
        .erl-chip {
          display: inline-flex; align-items: center; gap: 2px;
          background: var(--accent-wash); color: var(--accent);
          border-radius: 999px; font-size: 13px; font-weight: 600; padding-left: 4px;
        }
        .erl-chip-name { padding: 5px 4px 5px 8px; cursor: pointer; border-radius: 999px 0 0 999px; }
        .erl-chip-name:hover { text-decoration: underline; }
        .erl-chip-x {
          display: inline-flex; align-items: center; padding: 5px 8px 5px 4px;
          color: var(--accent); border-radius: 0 999px 999px 0; opacity: .7;
        }
        .erl-chip-x:hover { opacity: 1; background: var(--accent); color: #fff; }
      `}</style>
    </div>
  )
}

// ── Education ────────────────────────────────────────────────────────────────

export function EducationEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = useSortedItems('educations')
  const add = () => {
    const e: Education = {
      id: newId(), resume_id: data.resume!.id, school: {}, degree: {}, description: {},
      grade: null, exchange: false, start: null, end: null, skill_tags: [],
      sort_order: items.length, starred: false, disabled: false,
    }
    addItem('educations', e)
  }
  return (
    <div className="section-pane">
      <SectionIntro>
        Formal education that awards a degree or higher-education credits —
        universities, colleges and the like. Shorter technology or methodology
        training belongs under Courses.
      </SectionIntro>
      <SortBar section="educations" count={items.length} />
      <SortableList section="educations" ids={items.map((x) => x.id)} addLabel="Add education" onAdd={add}>
      {items.map((e) => (
        <EditorCard key={e.id} section="educations" id={e.id}
          title={resolve(e.school, primaryLocale)} subtitle={resolve(e.degree, primaryLocale)}
          meta={fmtRange(e.start, e.end)} preview={richToPlain(resolve(e.description, primaryLocale))}
          starred={e.starred} disabled={e.disabled}>
          <DualField label="School" value={e.school} onChange={(v) => updateItem('educations', e.id, { school: v })} />
          <DualField label="Degree" value={e.degree} onChange={(v) => updateItem('educations', e.id, { degree: v })} />
          <RichField label="Description" value={e.description} onChange={(v) => updateItem('educations', e.id, { description: v })} />
          <FieldRow>
            <DateField label="Start" value={e.start} onChange={(v) => updateItem('educations', e.id, { start: v })} />
            <DateField label="End" value={e.end} onChange={(v) => updateItem('educations', e.id, { end: v })} allowOngoing />
            <TextField label="Grade / result" value={e.grade || ''} onChange={(v) => updateItem('educations', e.id, { grade: v })} />
          </FieldRow>
          <label className="check-row">
            <input type="checkbox" checked={e.exchange} onChange={(ev) => updateItem('educations', e.id, { exchange: ev.target.checked })} />
            Study abroad / exchange programme
          </label>
        </EditorCard>
      ))}
      </SortableList>
    </div>
  )
}

// ── Courses ──────────────────────────────────────────────────────────────────

export function CoursesEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = useSortedItems('courses')
  const add = () => {
    const c: Course = {
      id: newId(), resume_id: data.resume!.id, name: {}, program: {}, description: {},
      completed: null, skill_ids: [], skill_tags: [], sort_order: items.length, starred: false, disabled: false,
    }
    addItem('courses', c)
  }
  return (
    <div className="section-pane">
      <SectionIntro>
        Shorter courses, training and workshops in specific technologies or
        methodologies. Degree-bearing study belongs under Education; formal
        accreditations under Certifications.
      </SectionIntro>
      <SortBar section="courses" count={items.length} />
      <SortableList section="courses" ids={items.map((x) => x.id)} addLabel="Add course" onAdd={add}>
      {items.map((c) => (
        <EditorCard key={c.id} section="courses" id={c.id}
          title={resolve(c.name, primaryLocale)} subtitle={resolve(c.program, primaryLocale)}
          meta={fmtDate(c.completed)} preview={richToPlain(resolve(c.description, primaryLocale))}
          starred={c.starred} disabled={c.disabled}>
          <DualField label="Course name" value={c.name} onChange={(v) => updateItem('courses', c.id, { name: v })} />
          <DualField label="Provider" value={c.program} onChange={(v) => updateItem('courses', c.id, { program: v })} />
          <RichField label="Description" value={c.description} onChange={(v) => updateItem('courses', c.id, { description: v })} />
          <DateField label="Completed" value={c.completed} onChange={(v) => updateItem('courses', c.id, { completed: v })} />
        </EditorCard>
      ))}
      </SortableList>
    </div>
  )
}

// ── Certifications ───────────────────────────────────────────────────────────

export function CertificationsEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = useSortedItems('certifications')
  const add = () => {
    const c: Certification = {
      id: newId(), resume_id: data.resume!.id, name: {}, organiser: {}, description: {},
      issued: null, expires: null, credential_url: null, skill_ids: [], skill_tags: [],
      sort_order: items.length, starred: false, disabled: false,
    }
    addItem('certifications', c)
  }
  return (
    <div className="section-pane">
      <SectionIntro>
        Professional certifications and accreditations. Set an expiry date and
        the Overview flags them before they lapse.
      </SectionIntro>
      <SortBar section="certifications" count={items.length} />
      <SortableList section="certifications" ids={items.map((x) => x.id)} addLabel="Add certification" onAdd={add}>
      {items.map((c) => (
        <EditorCard key={c.id} section="certifications" id={c.id}
          title={resolve(c.name, primaryLocale)} subtitle={resolve(c.organiser, primaryLocale)}
          meta={fmtDate(c.issued)} preview={richToPlain(resolve(c.description, primaryLocale))}
          starred={c.starred} disabled={c.disabled}>
          <DualField label="Certification" value={c.name} onChange={(v) => updateItem('certifications', c.id, { name: v })} />
          <DualField label="Issuing organisation" value={c.organiser} onChange={(v) => updateItem('certifications', c.id, { organiser: v })} />
          <RichField label="Description" value={c.description} onChange={(v) => updateItem('certifications', c.id, { description: v })} />
          <FieldRow>
            <DateField label="Issued" value={c.issued} onChange={(v) => updateItem('certifications', c.id, { issued: v })} />
            <DateField label="Expires" value={c.expires} onChange={(v) => updateItem('certifications', c.id, { expires: v })} allowOngoing />
          </FieldRow>
          <TextField label="Credential URL" value={c.credential_url || ''} onChange={(v) => updateItem('certifications', c.id, { credential_url: v })} />
        </EditorCard>
      ))}
      </SortableList>
    </div>
  )
}

// ── Positions ────────────────────────────────────────────────────────────────

export function PositionsEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = useSortedItems('positions')
  const add = () => {
    const p: Position = {
      id: newId(), resume_id: data.resume!.id, name: {}, organisation: {}, description: {},
      start: null, end: null, skill_tags: [], sort_order: items.length, starred: false, disabled: false,
    }
    addItem('positions', p)
  }
  return (
    <div className="section-pane">
      <SectionIntro>
        Board memberships, advisory roles, volunteer work, and other
        engagements outside of paid employment.
      </SectionIntro>
      <SortBar section="positions" count={items.length} />
      <SortableList section="positions" ids={items.map((x) => x.id)} addLabel="Add role" onAdd={add}>
      {items.map((p) => (
        <EditorCard key={p.id} section="positions" id={p.id}
          title={resolve(p.name, primaryLocale)}
          subtitle={[positionTypeLabel(p.position_type), resolve(p.organisation, primaryLocale)].filter(Boolean).join(' · ')}
          meta={fmtRange(p.start, p.end)} preview={richToPlain(resolve(p.description, primaryLocale))}
          starred={p.starred} disabled={p.disabled}>
          <DualField label="Position / role" value={p.name} onChange={(v) => updateItem('positions', p.id, { name: v })} />
          <DualField label="Organisation" value={p.organisation} onChange={(v) => updateItem('positions', p.id, { organisation: v })} />
          <RichField label="Description" value={p.description} onChange={(v) => updateItem('positions', p.id, { description: v })} />
          <FieldRow>
            <label className="pf-wrap">
              <span className="pf-label">Type</span>
              <select className="pf-input" value={p.position_type ?? ''}
                onChange={(e) => updateItem('positions', p.id, { position_type: e.target.value || null })}>
                <option value="">—</option>
                {POSITION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <DateField label="Start" value={p.start} onChange={(v) => updateItem('positions', p.id, { start: v })} />
            <DateField label="End" value={p.end} onChange={(v) => updateItem('positions', p.id, { end: v })} allowOngoing />
          </FieldRow>
        </EditorCard>
      ))}
      </SortableList>
    </div>
  )
}

// ── Presentations ────────────────────────────────────────────────────────────

export function PresentationsEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = useSortedItems('presentations')
  const add = () => {
    const p: Presentation = {
      id: newId(), resume_id: data.resume!.id, title: {}, event: {}, description: {},
      url: null, date: null, skill_tags: [], sort_order: items.length, starred: false, disabled: false,
    }
    addItem('presentations', p)
  }
  return (
    <div className="section-pane">
      <SectionIntro>
        Talks, conference sessions and workshops you have delivered — internal or
        public. Record the event, date and an optional abstract or link.
      </SectionIntro>
      <SortBar section="presentations" count={items.length} />
      <SortableList section="presentations" ids={items.map((x) => x.id)} addLabel="Add presentation" onAdd={add}>
      {items.map((p) => (
        <EditorCard key={p.id} section="presentations" id={p.id}
          title={resolve(p.title, primaryLocale)} subtitle={resolve(p.event, primaryLocale)}
          meta={fmtDate(p.date)} preview={richToPlain(resolve(p.description, primaryLocale))}
          starred={p.starred} disabled={p.disabled}>
          <DualField label="Title" value={p.title} onChange={(v) => updateItem('presentations', p.id, { title: v })} />
          <DualField label="Event / venue" value={p.event} onChange={(v) => updateItem('presentations', p.id, { event: v })} />
          <RichField label="Abstract" value={p.description} onChange={(v) => updateItem('presentations', p.id, { description: v })} />
          <FieldRow>
            <DateField label="Date" value={p.date} onChange={(v) => updateItem('presentations', p.id, { date: v })} />
            <TextField label="URL" value={p.url || ''} onChange={(v) => updateItem('presentations', p.id, { url: v })} />
          </FieldRow>
        </EditorCard>
      ))}
      </SortableList>
    </div>
  )
}

// ── Publications ─────────────────────────────────────────────────────────────

export function PublicationsEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = useSortedItems('publications')
  const add = () => {
    const p: Publication = {
      id: newId(), resume_id: data.resume!.id, title: {}, publisher: {}, co_authors: [], abstract: {},
      url: null, date: null, publication_type: 'article', skill_tags: [], sort_order: items.length,
      starred: false, disabled: false, internal_notes: null,
    }
    addItem('publications', p)
  }
  return (
    <div className="section-pane">
      <SectionIntro>
        Articles, research publications, theses, whitepapers, books, reports and
        blog posts you have authored — with the publisher, co-authors, date and a
        link to the original.
      </SectionIntro>
      <SortBar section="publications" count={items.length} />
      <SortableList section="publications" ids={items.map((x) => x.id)} addLabel="Add publication" onAdd={add}>
      {items.map((p) => (
        <EditorCard key={p.id} section="publications" id={p.id}
          title={resolve(p.title, primaryLocale)} subtitle={resolve(p.publisher, primaryLocale)}
          meta={fmtDate(p.date)} preview={richToPlain(resolve(p.abstract, primaryLocale))}
          starred={p.starred} disabled={p.disabled}>
          <DualField label="Title" value={p.title} onChange={(v) => updateItem('publications', p.id, { title: v })} />
          <DualField label="Publisher" value={p.publisher} onChange={(v) => updateItem('publications', p.id, { publisher: v })} />
          <TextField
            label="Co-authors"
            value={p.co_authors.join(', ')}
            onChange={(v) => updateItem('publications', p.id, { co_authors: v.split(',').map((s) => s.trim()).filter(Boolean) })}
            placeholder="Comma-separated, e.g. Jane Doe, John Roe"
          />
          <RichField label="Abstract" value={p.abstract} onChange={(v) => updateItem('publications', p.id, { abstract: v })} />
          <FieldRow>
            <label className="pf-wrap">
              <span className="pf-label">Type</span>
              <select className="pf-input" value={p.publication_type}
                onChange={(e) => updateItem('publications', p.id, { publication_type: e.target.value as Publication['publication_type'] })}>
                {PUBLICATION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <DateField label="Date" value={p.date} onChange={(v) => updateItem('publications', p.id, { date: v })} />
            <TextField label="URL" value={p.url || ''} onChange={(v) => updateItem('publications', p.id, { url: v })} />
          </FieldRow>
        </EditorCard>
      ))}
      </SortableList>
    </div>
  )
}

// ── Awards ───────────────────────────────────────────────────────────────────

export function AwardsEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = useSortedItems('honor_awards')
  const add = () => {
    const a: HonorAward = {
      id: newId(), resume_id: data.resume!.id, name: {}, issuer: {}, for_work: {}, description: {},
      date: null, skill_tags: [], sort_order: items.length, disabled: false,
    }
    addItem('honor_awards', a)
  }
  return (
    <div className="section-pane">
      <SectionIntro>
        Honours, prizes and recognition you have received, professional or
        academic — noting the issuer and what each was for.
      </SectionIntro>
      <SortBar section="honor_awards" count={items.length} />
      <SortableList section="honor_awards" ids={items.map((x) => x.id)} addLabel="Add award" onAdd={add}>
      {items.map((a) => (
        <EditorCard key={a.id} section="honor_awards" id={a.id}
          title={resolve(a.name, primaryLocale)} subtitle={resolve(a.issuer, primaryLocale)}
          meta={fmtDate(a.date)} preview={richToPlain(resolve(a.description, primaryLocale))}
          disabled={a.disabled} canStar={false}>
          <DualField label="Award" value={a.name} onChange={(v) => updateItem('honor_awards', a.id, { name: v })} />
          <DualField label="Issuer" value={a.issuer} onChange={(v) => updateItem('honor_awards', a.id, { issuer: v })} />
          <DualField label="For work" value={a.for_work} onChange={(v) => updateItem('honor_awards', a.id, { for_work: v })} />
          <RichField label="Description" value={a.description} onChange={(v) => updateItem('honor_awards', a.id, { description: v })} />
          <DateField label="Date" value={a.date} onChange={(v) => updateItem('honor_awards', a.id, { date: v })} />
        </EditorCard>
      ))}
      </SortableList>
    </div>
  )
}

// ── Spoken languages ─────────────────────────────────────────────────────────

export function SpokenLanguagesEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = useSortedItems('spoken_languages')
  const add = () => {
    const l: SpokenLanguage = { id: newId(), resume_id: data.resume!.id, name: {}, level: {}, sort_order: items.length, disabled: false }
    addItem('spoken_languages', l)
  }
  return (
    <div className="section-pane">
      <SectionIntro>
        Spoken languages and your proficiency in each — for example Native,
        Fluent, or Working knowledge.
      </SectionIntro>
      <SortBar section="spoken_languages" count={items.length} />
      <SortableList section="spoken_languages" ids={items.map((x) => x.id)} addLabel="Add language" onAdd={add}>
      {items.map((l) => (
        <EditorCard key={l.id} section="spoken_languages" id={l.id}
          title={resolve(l.name, primaryLocale)} subtitle={resolve(l.level, primaryLocale)}
          disabled={l.disabled} canStar={false}>
          <DualField label="Language" value={l.name} onChange={(v) => updateItem('spoken_languages', l.id, { name: v })} />
          <DualField label="Proficiency level" value={l.level} onChange={(v) => updateItem('spoken_languages', l.id, { level: v })} />
        </EditorCard>
      ))}
      </SortableList>
    </div>
  )
}

// ── Key competencies ───────────────────────────────────────────────────────

export function KeyCompetenciesEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = useSortedItems('key_competencies')
  const add = () => {
    const k: KeyCompetency = {
      id: newId(), resume_id: data.resume!.id, title: {}, description: {},
      sort_order: items.length, starred: false, disabled: false,
    }
    addItem('key_competencies', k)
  }
  return (
    <div className="section-pane">
      <SectionIntro>
        Your headline strengths — each a short heading with a supporting
        description. They export as their own section, by default just below
        your profile.
      </SectionIntro>
      <SortBar section="key_competencies" count={items.length} />
      <SortableList section="key_competencies" ids={items.map((x) => x.id)} addLabel="Add competency" onAdd={add}>
      {items.map((k) => (
        <EditorCard key={k.id} section="key_competencies" id={k.id}
          title={resolve(k.title, primaryLocale) || 'Competency'}
          preview={richToPlain(resolve(k.description, primaryLocale))}
          starred={k.starred} disabled={k.disabled}>
          <DualField label="Competency" value={k.title} onChange={(v) => updateItem('key_competencies', k.id, { title: v })} placeholder="e.g. Solution architecture" />
          <RichField label="Description" value={k.description} onChange={(v) => updateItem('key_competencies', k.id, { description: v })} />
        </EditorCard>
      ))}
      </SortableList>
    </div>
  )
}

// ── Recommendations ────────────────────────────────────────────────────────

export function RecommendationsEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = useSortedItems('recommendations')
  const add = () => {
    const r: Recommendation = {
      id: newId(), resume_id: data.resume!.id,
      recommender_name: '', recommender_title: {}, recommender_company: null,
      relationship: {}, text: {}, date: null, source: null, contact_url: null,
      sort_order: items.length, starred: false, disabled: false,
    }
    addItem('recommendations', r)
  }
  return (
    <div className="section-pane">
      <SectionIntro>
        Testimonials you have received from colleagues and customers. Choose which
        ones appear in each Resume View from the view editor.
      </SectionIntro>
      <SortBar section="recommendations" count={items.length} />
      <SortableList section="recommendations" ids={items.map((x) => x.id)} addLabel="Add recommendation" onAdd={add}>
      {items.map((r) => (
        <EditorCard key={r.id} section="recommendations" id={r.id}
          title={r.recommender_name || 'Recommendation'}
          subtitle={[resolve(r.recommender_title, primaryLocale), r.recommender_company].filter(Boolean).join(', ')}
          meta={fmtDate(r.date)} preview={richToPlain(resolve(r.text, primaryLocale))}
          starred={r.starred} disabled={r.disabled}>
          <FieldRow>
            <DateField label="Date received" value={r.date} onChange={(v) => updateItem('recommendations', r.id, { date: v })} />
            <TextField label="Source" value={r.source || ''} onChange={(v) => updateItem('recommendations', r.id, { source: v || null })} placeholder="e.g. LinkedIn" />
            <TextField label="Link" value={r.contact_url || ''} onChange={(v) => updateItem('recommendations', r.id, { contact_url: v || null })} />
          </FieldRow>
          <RichField label="Testimonial" value={r.text} onChange={(v) => updateItem('recommendations', r.id, { text: v })} />
          <FieldRow>
            <TextField label="Recommender" value={r.recommender_name} onChange={(v) => updateItem('recommendations', r.id, { recommender_name: v })} />
            <TextField label="Company" value={r.recommender_company || ''} onChange={(v) => updateItem('recommendations', r.id, { recommender_company: v || null })} />
          </FieldRow>
          <DualField label="Title / role" value={r.recommender_title} onChange={(v) => updateItem('recommendations', r.id, { recommender_title: v })} placeholder="e.g. Chief Technology Officer" />
          <RelationshipField label="Relationship" value={r.relationship} primaryLocale={primaryLocale}
            onChange={(v) => updateItem('recommendations', r.id, { relationship: v })} />
        </EditorCard>
      ))}
      </SortableList>
    </div>
  )
}

/**
 * The recommender-relationship picker: a dropdown of curated, per-language
 * options (LinkedIn-style) instead of free text. Picking an option stamps its
 * full localized label set so every export language shows the right phrasing;
 * the visible option labels follow `primaryLocale`. A legacy free-text value
 * that matches no option is preserved as a leading "(current)" option so old
 * data isn't silently dropped.
 */
function RelationshipField({ label, value, primaryLocale, onChange }: {
  label: string; value: LocalizedString; primaryLocale: string
  onChange: (v: LocalizedString) => void
}) {
  const id = useId()
  const matchedKey = matchRelationshipKey(value)
  const current = resolve(value, primaryLocale)
  const isCustom = !matchedKey && !!current.trim()
  return (
    <label className="pf-wrap">
      <span className="pf-label">{label}</span>
      <select id={id} className="pf-input" value={isCustom ? '__custom' : (matchedKey ?? '')}
        onChange={(e) => {
          const key = e.target.value
          if (key === '__custom') return // keep the existing free-text value
          onChange(key ? relationshipLabels(key) : {})
        }}>
        <option value="">— Select —</option>
        {isCustom && <option value="__custom">{current}</option>}
        {RELATIONSHIP_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>{resolve(o.labels, primaryLocale)}</option>
        ))}
      </select>
    </label>
  )
}

// ── Profile / key qualifications ──────────────────────────────────────────────

export function ProfileEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = useSortedItems('key_qualifications')
  const add = () => {
    const k: KeyQualification = {
      id: newId(), resume_id: data.resume!.id, label: {}, tag_line: {}, summary: {},
      key_points: [], skill_tags: [], sort_order: items.length, starred: false, disabled: false, internal_notes: null,
    }
    addItem('key_qualifications', k)
  }

  // Per-KQ key_points are deprecated UI: the standalone "Key Competencies"
  // section owns those now (see migrate.extractKeyPointsToCompetencies +
  // KeyCompetenciesEditor). The Profile block stays focused on the prose
  // summary and tag line.
  return (
    <div className="section-pane">
      <SectionIntro>
        The opening statement of your CV — a short summary and tag line that
        lead every export.
      </SectionIntro>
      <SortBar section="key_qualifications" count={items.length} />
      <SortableList section="key_qualifications" ids={items.map((x) => x.id)} addLabel="Add profile block" onAdd={add}>
      {items.map((kq) => (
        <EditorCard key={kq.id} section="key_qualifications" id={kq.id}
          title={resolve(kq.label, primaryLocale) || 'Profile'} subtitle={resolve(kq.tag_line, primaryLocale)}
          preview={richToPlain(resolve(kq.summary, primaryLocale))}
          starred={kq.starred} disabled={kq.disabled}>
          <DualField label="Section label" value={kq.label} onChange={(v) => updateItem('key_qualifications', kq.id, { label: v })} />
          <DualField label="Tag line" value={kq.tag_line} onChange={(v) => updateItem('key_qualifications', kq.id, { tag_line: v })} />
          <RichField label="Summary" value={kq.summary} onChange={(v) => updateItem('key_qualifications', kq.id, { summary: v })} />
        </EditorCard>
      ))}
      </SortableList>
    </div>
  )
}

// (.check-row styling now lives in src/index.css)
