import { useStore, newId } from '../../store/useStore'
import { DualField } from '../ui/DualField'
import { TextField, DateField, TagField } from '../ui/Fields'
import { EditorCard, AddButton, FieldRow } from '../ui/EditorCard'
import { SortableList } from '../ui/SortableList'
import { resolve, fmtRange, fmtDate } from '../../lib/locales'
import type {
  WorkExperience, Education, Course, Certification, Position,
  Presentation, HonorAward, Publication, SpokenLanguage, KeyQualification,
} from '../../types'

// ── Employment ────────────────────────────────────────────────────────────────

export function WorkEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = [...data.work_experiences].sort((a, b) => a.sort_order - b.sort_order)
  const add = () => {
    const w: WorkExperience = {
      id: newId(), resume_id: data.resume!.id, employer: {}, role_title: {}, description: {},
      long_description: {}, employment_type: null, company_size: null, company_url: null,
      start: null, end: null, skill_tags: [], sort_order: items.length, starred: false, disabled: false, internal_notes: null,
    }
    addItem('work_experiences', w)
  }
  return (
    <div className="section-pane">
      <SortableList section="work_experiences" ids={items.map((x) => x.id)}>
      {items.map((w) => (
        <EditorCard key={w.id} section="work_experiences" id={w.id}
          title={resolve(w.employer, primaryLocale)} subtitle={resolve(w.role_title, primaryLocale)}
          meta={fmtRange(w.start, w.end)} starred={w.starred} disabled={w.disabled}>
          <DualField label="Employer" value={w.employer} onChange={(v) => updateItem('work_experiences', w.id, { employer: v })} />
          <DualField label="Role / title" value={w.role_title} onChange={(v) => updateItem('work_experiences', w.id, { role_title: v })} />
          <DualField label="Description" value={w.long_description} onChange={(v) => updateItem('work_experiences', w.id, { long_description: v })} multiline rows={4} />
          <FieldRow>
            <DateField label="Start" value={w.start} onChange={(v) => updateItem('work_experiences', w.id, { start: v })} />
            <DateField label="End" value={w.end} onChange={(v) => updateItem('work_experiences', w.id, { end: v })} allowOngoing />
          </FieldRow>
          <FieldRow>
            <div className="pf-wrap">
              <label className="pf-label">Employment type</label>
              <select className="pf-input" value={w.employment_type || ''}
                onChange={(e) => updateItem('work_experiences', w.id, { employment_type: (e.target.value || null) as WorkExperience['employment_type'] })}>
                <option value="">—</option>
                <option value="permanent">Permanent</option>
                <option value="contract">Contract</option>
                <option value="freelance">Freelance</option>
                <option value="part_time">Part-time</option>
              </select>
            </div>
            <TextField label="Company size" value={w.company_size || ''} onChange={(v) => updateItem('work_experiences', w.id, { company_size: v })} />
            <TextField label="Company URL" value={w.company_url || ''} onChange={(v) => updateItem('work_experiences', w.id, { company_url: v })} />
          </FieldRow>
        </EditorCard>
      ))}
      </SortableList>
      <AddButton label="Add employment" onClick={add} />
    </div>
  )
}

// ── Education ────────────────────────────────────────────────────────────────

export function EducationEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = [...data.educations].sort((a, b) => a.sort_order - b.sort_order)
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
      <SortableList section="educations" ids={items.map((x) => x.id)}>
      {items.map((e) => (
        <EditorCard key={e.id} section="educations" id={e.id}
          title={resolve(e.school, primaryLocale)} subtitle={resolve(e.degree, primaryLocale)}
          meta={fmtRange(e.start, e.end)} starred={e.starred} disabled={e.disabled}>
          <DualField label="School" value={e.school} onChange={(v) => updateItem('educations', e.id, { school: v })} />
          <DualField label="Degree" value={e.degree} onChange={(v) => updateItem('educations', e.id, { degree: v })} />
          <DualField label="Specialisation / thesis" value={e.description} onChange={(v) => updateItem('educations', e.id, { description: v })} multiline rows={3} />
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
      <AddButton label="Add education" onClick={add} />
    </div>
  )
}

// ── Courses ──────────────────────────────────────────────────────────────────

export function CoursesEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = [...data.courses].sort((a, b) => a.sort_order - b.sort_order)
  const add = () => {
    const c: Course = {
      id: newId(), resume_id: data.resume!.id, name: {}, program: {}, description: {},
      completed: null, skill_ids: [], skill_tags: [], sort_order: items.length, starred: false, disabled: false,
    }
    addItem('courses', c)
  }
  return (
    <div className="section-pane">
      <SortableList section="courses" ids={items.map((x) => x.id)}>
      {items.map((c) => (
        <EditorCard key={c.id} section="courses" id={c.id}
          title={resolve(c.name, primaryLocale)} subtitle={resolve(c.program, primaryLocale)}
          meta={fmtDate(c.completed)} starred={c.starred} disabled={c.disabled}>
          <DualField label="Course name" value={c.name} onChange={(v) => updateItem('courses', c.id, { name: v })} />
          <DualField label="Provider" value={c.program} onChange={(v) => updateItem('courses', c.id, { program: v })} />
          <DualField label="Description" value={c.description} onChange={(v) => updateItem('courses', c.id, { description: v })} multiline rows={2} />
          <DateField label="Completed" value={c.completed} onChange={(v) => updateItem('courses', c.id, { completed: v })} />
        </EditorCard>
      ))}
      </SortableList>
      <AddButton label="Add course" onClick={add} />
    </div>
  )
}

// ── Certifications ───────────────────────────────────────────────────────────

export function CertificationsEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = [...data.certifications].sort((a, b) => a.sort_order - b.sort_order)
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
      <SortableList section="certifications" ids={items.map((x) => x.id)}>
      {items.map((c) => (
        <EditorCard key={c.id} section="certifications" id={c.id}
          title={resolve(c.name, primaryLocale)} subtitle={resolve(c.organiser, primaryLocale)}
          meta={fmtDate(c.issued)} starred={c.starred} disabled={c.disabled}>
          <DualField label="Certification" value={c.name} onChange={(v) => updateItem('certifications', c.id, { name: v })} />
          <DualField label="Issuing organisation" value={c.organiser} onChange={(v) => updateItem('certifications', c.id, { organiser: v })} />
          <DualField label="Description" value={c.description} onChange={(v) => updateItem('certifications', c.id, { description: v })} multiline rows={2} />
          <FieldRow>
            <DateField label="Issued" value={c.issued} onChange={(v) => updateItem('certifications', c.id, { issued: v })} />
            <DateField label="Expires" value={c.expires} onChange={(v) => updateItem('certifications', c.id, { expires: v })} allowOngoing />
          </FieldRow>
          <TextField label="Credential URL" value={c.credential_url || ''} onChange={(v) => updateItem('certifications', c.id, { credential_url: v })} />
        </EditorCard>
      ))}
      </SortableList>
      <AddButton label="Add certification" onClick={add} />
    </div>
  )
}

// ── Positions ────────────────────────────────────────────────────────────────

export function PositionsEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = [...data.positions].sort((a, b) => a.sort_order - b.sort_order)
  const add = () => {
    const p: Position = {
      id: newId(), resume_id: data.resume!.id, name: {}, organisation: {}, description: {},
      start: null, end: null, skill_tags: [], sort_order: items.length, starred: false, disabled: false,
    }
    addItem('positions', p)
  }
  return (
    <div className="section-pane">
      <SortableList section="positions" ids={items.map((x) => x.id)}>
      {items.map((p) => (
        <EditorCard key={p.id} section="positions" id={p.id}
          title={resolve(p.name, primaryLocale)} subtitle={resolve(p.organisation, primaryLocale)}
          meta={fmtRange(p.start, p.end)} starred={p.starred} disabled={p.disabled}>
          <DualField label="Position / role" value={p.name} onChange={(v) => updateItem('positions', p.id, { name: v })} />
          <DualField label="Organisation" value={p.organisation} onChange={(v) => updateItem('positions', p.id, { organisation: v })} />
          <DualField label="Description" value={p.description} onChange={(v) => updateItem('positions', p.id, { description: v })} multiline rows={2} />
          <FieldRow>
            <DateField label="Start" value={p.start} onChange={(v) => updateItem('positions', p.id, { start: v })} />
            <DateField label="End" value={p.end} onChange={(v) => updateItem('positions', p.id, { end: v })} allowOngoing />
          </FieldRow>
        </EditorCard>
      ))}
      </SortableList>
      <AddButton label="Add position" onClick={add} />
    </div>
  )
}

// ── Presentations ────────────────────────────────────────────────────────────

export function PresentationsEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = [...data.presentations].sort((a, b) => a.sort_order - b.sort_order)
  const add = () => {
    const p: Presentation = {
      id: newId(), resume_id: data.resume!.id, title: {}, event: {}, description: {},
      url: null, date: null, skill_tags: [], sort_order: items.length, starred: false, disabled: false,
    }
    addItem('presentations', p)
  }
  return (
    <div className="section-pane">
      <SortableList section="presentations" ids={items.map((x) => x.id)}>
      {items.map((p) => (
        <EditorCard key={p.id} section="presentations" id={p.id}
          title={resolve(p.title, primaryLocale)} subtitle={resolve(p.event, primaryLocale)}
          meta={fmtDate(p.date)} starred={p.starred} disabled={p.disabled}>
          <DualField label="Title" value={p.title} onChange={(v) => updateItem('presentations', p.id, { title: v })} />
          <DualField label="Event / venue" value={p.event} onChange={(v) => updateItem('presentations', p.id, { event: v })} />
          <DualField label="Abstract" value={p.description} onChange={(v) => updateItem('presentations', p.id, { description: v })} multiline rows={3} />
          <FieldRow>
            <DateField label="Date" value={p.date} onChange={(v) => updateItem('presentations', p.id, { date: v })} />
            <TextField label="URL" value={p.url || ''} onChange={(v) => updateItem('presentations', p.id, { url: v })} />
          </FieldRow>
        </EditorCard>
      ))}
      </SortableList>
      <AddButton label="Add presentation" onClick={add} />
    </div>
  )
}

// ── Publications ─────────────────────────────────────────────────────────────

export function PublicationsEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = [...data.publications].sort((a, b) => a.sort_order - b.sort_order)
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
      <SortableList section="publications" ids={items.map((x) => x.id)}>
      {items.map((p) => (
        <EditorCard key={p.id} section="publications" id={p.id}
          title={resolve(p.title, primaryLocale)} subtitle={resolve(p.publisher, primaryLocale)}
          meta={fmtDate(p.date)} starred={p.starred} disabled={p.disabled}>
          <DualField label="Title" value={p.title} onChange={(v) => updateItem('publications', p.id, { title: v })} />
          <DualField label="Publisher" value={p.publisher} onChange={(v) => updateItem('publications', p.id, { publisher: v })} />
          <DualField label="Abstract" value={p.abstract} onChange={(v) => updateItem('publications', p.id, { abstract: v })} multiline rows={3} />
          <FieldRow>
            <div className="pf-wrap">
              <label className="pf-label">Type</label>
              <select className="pf-input" value={p.publication_type}
                onChange={(e) => updateItem('publications', p.id, { publication_type: e.target.value as Publication['publication_type'] })}>
                <option value="article">Article</option>
                <option value="whitepaper">Whitepaper</option>
                <option value="book">Book</option>
                <option value="book_chapter">Book chapter</option>
                <option value="blog_post">Blog post</option>
                <option value="report">Report</option>
              </select>
            </div>
            <DateField label="Date" value={p.date} onChange={(v) => updateItem('publications', p.id, { date: v })} />
            <TextField label="URL" value={p.url || ''} onChange={(v) => updateItem('publications', p.id, { url: v })} />
          </FieldRow>
        </EditorCard>
      ))}
      </SortableList>
      <AddButton label="Add publication" onClick={add} />
    </div>
  )
}

// ── Awards ───────────────────────────────────────────────────────────────────

export function AwardsEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = [...data.honor_awards].sort((a, b) => a.sort_order - b.sort_order)
  const add = () => {
    const a: HonorAward = {
      id: newId(), resume_id: data.resume!.id, name: {}, issuer: {}, for_work: {}, description: {},
      date: null, skill_tags: [], sort_order: items.length, disabled: false,
    }
    addItem('honor_awards', a)
  }
  return (
    <div className="section-pane">
      <SortableList section="honor_awards" ids={items.map((x) => x.id)}>
      {items.map((a) => (
        <EditorCard key={a.id} section="honor_awards" id={a.id}
          title={resolve(a.name, primaryLocale)} subtitle={resolve(a.issuer, primaryLocale)}
          meta={fmtDate(a.date)} disabled={a.disabled} canStar={false}>
          <DualField label="Award" value={a.name} onChange={(v) => updateItem('honor_awards', a.id, { name: v })} />
          <DualField label="Issuer" value={a.issuer} onChange={(v) => updateItem('honor_awards', a.id, { issuer: v })} />
          <DualField label="For work" value={a.for_work} onChange={(v) => updateItem('honor_awards', a.id, { for_work: v })} />
          <DualField label="Description" value={a.description} onChange={(v) => updateItem('honor_awards', a.id, { description: v })} multiline rows={2} />
          <DateField label="Date" value={a.date} onChange={(v) => updateItem('honor_awards', a.id, { date: v })} />
        </EditorCard>
      ))}
      </SortableList>
      <AddButton label="Add award" onClick={add} />
    </div>
  )
}

// ── Spoken languages ─────────────────────────────────────────────────────────

export function SpokenLanguagesEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = [...data.spoken_languages].sort((a, b) => a.sort_order - b.sort_order)
  const add = () => {
    const l: SpokenLanguage = { id: newId(), resume_id: data.resume!.id, name: {}, level: {}, sort_order: items.length, disabled: false }
    addItem('spoken_languages', l)
  }
  return (
    <div className="section-pane">
      <SortableList section="spoken_languages" ids={items.map((x) => x.id)}>
      {items.map((l) => (
        <EditorCard key={l.id} section="spoken_languages" id={l.id}
          title={resolve(l.name, primaryLocale)} subtitle={resolve(l.level, primaryLocale)}
          disabled={l.disabled} canStar={false}>
          <DualField label="Language" value={l.name} onChange={(v) => updateItem('spoken_languages', l.id, { name: v })} />
          <DualField label="Proficiency level" value={l.level} onChange={(v) => updateItem('spoken_languages', l.id, { level: v })} />
        </EditorCard>
      ))}
      </SortableList>
      <AddButton label="Add language" onClick={add} />
    </div>
  )
}

// ── Profile / key qualifications ──────────────────────────────────────────────

export function ProfileEditor() {
  const { data, primaryLocale, secondaryLocale, addItem, updateItem } = useStore()
  const items = [...data.key_qualifications].sort((a, b) => a.sort_order - b.sort_order)
  const add = () => {
    const k: KeyQualification = {
      id: newId(), resume_id: data.resume!.id, label: {}, tag_line: {}, summary: {},
      key_points: [], skill_tags: [], sort_order: items.length, starred: false, disabled: false, internal_notes: null,
    }
    addItem('key_qualifications', k)
  }
  const updatePoint = (kqId: string, idx: number, locale: string, text: string) => {
    const kq = items.find((x) => x.id === kqId)!
    const next = kq.key_points.map((kp, i) => {
      if (i !== idx) return kp
      const name = { ...kp.name }
      if (text) name[locale] = text; else delete name[locale]
      return { ...kp, name }
    })
    updateItem('key_qualifications', kqId, { key_points: next })
  }
  const addPoint = (kqId: string) => {
    const kq = items.find((x) => x.id === kqId)!
    updateItem('key_qualifications', kqId, { key_points: [...kq.key_points, { id: newId(), name: {}, long_description: {}, sort_order: kq.key_points.length, disabled: false }] })
  }
  const removePoint = (kqId: string, idx: number) => {
    const kq = items.find((x) => x.id === kqId)!
    updateItem('key_qualifications', kqId, { key_points: kq.key_points.filter((_, i) => i !== idx) })
  }

  return (
    <div className="section-pane">
      <SortableList section="key_qualifications" ids={items.map((x) => x.id)}>
      {items.map((kq) => (
        <EditorCard key={kq.id} section="key_qualifications" id={kq.id}
          title={resolve(kq.label, primaryLocale) || 'Profile'} subtitle={resolve(kq.tag_line, primaryLocale)}
          starred={kq.starred} disabled={kq.disabled}>
          <DualField label="Section label" value={kq.label} onChange={(v) => updateItem('key_qualifications', kq.id, { label: v })} />
          <DualField label="Tag line" value={kq.tag_line} onChange={(v) => updateItem('key_qualifications', kq.id, { tag_line: v })} />
          <DualField label="Summary" value={kq.summary} onChange={(v) => updateItem('key_qualifications', kq.id, { summary: v })} multiline rows={6} />
          <div className="sub-block">
            <div className="sub-head">Key competency points</div>
            {kq.key_points.map((kp, i) => (
              <div key={kp.id} className="hl-row">
                <div className={`hl-inputs ${secondaryLocale ? 'dual' : ''}`}>
                  <input className="hl-input" value={kp.name[primaryLocale] || ''} placeholder="Competency…"
                    onChange={(e) => updatePoint(kq.id, i, primaryLocale, e.target.value)} />
                  {secondaryLocale && (
                    <input className="hl-input hl-sec" value={kp.name[secondaryLocale] || ''} placeholder="…"
                      onChange={(e) => updatePoint(kq.id, i, secondaryLocale, e.target.value)} />
                  )}
                </div>
                <button className="hl-del" onClick={() => removePoint(kq.id, i)}>×</button>
              </div>
            ))}
            <button className="sub-add" onClick={() => addPoint(kq.id)}>+ Add competency</button>
          </div>
        </EditorCard>
      ))}
      </SortableList>
      <AddButton label="Add profile block" onClick={add} />
    </div>
  )
}

// (.check-row styling now lives in src/index.css)
