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
import { EMPLOYMENT_TYPES, employmentTypeLabel } from '../../lib/employmentTypes'
import { COURSE_CATEGORIES, courseCategoryLabel } from '../../lib/courseCategories'
import { CEFR_CATEGORIES, CEFR_LEVELS, CEFR_LEVEL_DESC, cefrSummary } from '../../lib/cefr'
import type {
  WorkExperience, Education, Course, Certification, Position,
  Presentation, HonorAward, Publication, SpokenLanguage, KeyQualification,
  KeyCompetency, Recommendation, Role, LocalizedString, CefrCategory, CefrLevel,
} from '../../types'
import { X, ChevronUp, ChevronDown, Plus, GripVertical } from 'lucide-react'
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { RegistryLightbox } from './RegistryCategoryView'

/** Current year+month as a YearMonth — the default "To" date for a new course. */
function thisMonth(): { year: number; month: number } {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

/**
 * The shared Course/Certification "Category" picker — an editor-only organizing
 * type (never exported). Same vocabulary for both sections (lib/courseCategories).
 */
function CategorySelect({ value, onChange }: { value: string | null | undefined; onChange: (v: string | null) => void }) {
  return (
    <label className="pf-wrap">
      <span className="pf-label">Category</span>
      <select className="pf-input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {COURSE_CATEGORIES.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>
    </label>
  )
}

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
      <SortBar section="work_experiences" />
      <SortableList section="work_experiences" ids={items.map((x) => x.id)} addLabel="Add employment" onAdd={add}>
      {items.map((w) => (
        <EditorCard key={w.id} section="work_experiences" id={w.id}
          title={resolve(w.employer, primaryLocale)}
          subtitle={[resolve(w.role_title, primaryLocale), employmentTypeLabel(w.employment_type)].filter(Boolean).join(' · ')}
          meta={fmtRange(w.start, w.end)} preview={richToPlain(resolve(w.long_description, primaryLocale))}
          starred={w.starred} disabled={w.disabled}>
          <DualField label="Employer" value={w.employer} onChange={(v) => updateItem('work_experiences', w.id, { employer: v })} />
          <DualField label="Position title" value={w.role_title} onChange={(v) => updateItem('work_experiences', w.id, { role_title: v })} placeholder="Your title as held at this company" />
          <RoleTypeLinks roleIds={w.role_ids} hint="— the general role held, for summarising experience across positions (independent of the title above)"
            onChange={(ids) => updateItem('work_experiences', w.id, { role_ids: ids })} />
          <RichField label="Description" value={w.long_description} onChange={(v) => updateItem('work_experiences', w.id, { long_description: v })} />
          <DualField label="Short description (summary mode)" value={w.short_description ?? {}} onChange={(v) => updateItem('work_experiences', w.id, { short_description: v })} summarizeFrom={w.long_description} placeholder="One concise line shown in summary mode" />
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
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
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
 * Links an item (employment or "Other role") to one or MORE registry Roles
 * indicating the general ROLE TYPE(S) held (e.g. "Architect", "Board Member") —
 * independent of the item's own free-text title. Mirrors the project.roles[]
 * chip pattern so role-registry merges rewrite these links, the role-usage
 * panel lists the item, and its calendar span feeds the role's computed years
 * of experience. The caller owns persistence via `onChange`.
 */
function RoleTypeLinks({ roleIds, onChange, hint }: {
  roleIds: string[]
  onChange: (roleIds: string[]) => void
  hint: string
}) {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const linked = roleIds
    .map((id) => data.roles.find((r) => r.id === id))
    .filter((r): r is Role => !!r)
  const editing = editingId ? data.roles.find((r) => r.id === editingId) ?? null : null

  const add = (roleId: string) => {
    if (roleIds.includes(roleId)) return
    onChange([...roleIds, roleId])
  }
  const remove = (roleId: string) => onChange(roleIds.filter((id) => id !== roleId))
  const createAndAdd = (text: string) => {
    const r: Role = {
      id: newId(), resume_id: data.resume!.id,
      name: { [primaryLocale]: text },
      years_of_experience: 0, years_of_experience_offset: 0,
      starred: false, sort_order: data.roles.length, disabled: false,
    }
    // open:false — creating the role must not steal focus from (and collapse)
    // the parent card. Link the new id immediately (the item's title untouched).
    addItem('roles', r, { open: false })
    onChange([...roleIds, r.id])
  }

  return (
    <div className="erl-wrap">
      <label className="erl-label">Role type(s) <span className="erl-hint">{hint}</span></label>
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
          .filter((r) => !r.disabled && !roleIds.includes(r.id))
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
      <SortBar section="educations" />
      <SortableList section="educations" ids={items.map((x) => x.id)} addLabel="Add education" onAdd={add}>
      {items.map((e) => (
        <EditorCard key={e.id} section="educations" id={e.id}
          title={resolve(e.school, primaryLocale)} subtitle={resolve(e.degree, primaryLocale)}
          meta={fmtRange(e.start, e.end)} preview={richToPlain(resolve(e.description, primaryLocale))}
          starred={e.starred} disabled={e.disabled}>
          <DualField label="School" value={e.school} onChange={(v) => updateItem('educations', e.id, { school: v })} />
          <DualField label="Degree" value={e.degree} onChange={(v) => updateItem('educations', e.id, { degree: v })} />
          <RichField label="Description" value={e.description} onChange={(v) => updateItem('educations', e.id, { description: v })} />
          <DualField label="Short description (summary mode)" value={e.short_description ?? {}} onChange={(v) => updateItem('educations', e.id, { short_description: v })} summarizeFrom={e.description} placeholder="One concise line shown in summary mode" />
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
      // New courses default the "To" date to today and leave "From" blank; an
      // empty To later reads as ongoing (like every other date range).
      start: null, end: thisMonth(), category: null,
      skill_ids: [], skill_tags: [], sort_order: items.length, starred: false, disabled: false,
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
      <SortBar section="courses" />
      <SortableList section="courses" ids={items.map((x) => x.id)} addLabel="Add course" onAdd={add}>
      {items.map((c) => (
        <EditorCard key={c.id} section="courses" id={c.id}
          title={resolve(c.name, primaryLocale)}
          subtitle={[resolve(c.program, primaryLocale), courseCategoryLabel(c.category)].filter(Boolean).join(' · ')}
          meta={fmtRange(c.start, c.end)} preview={richToPlain(resolve(c.description, primaryLocale))}
          starred={c.starred} disabled={c.disabled}>
          <DualField label="Course name" value={c.name} onChange={(v) => updateItem('courses', c.id, { name: v })} />
          <DualField label="Provider" value={c.program} onChange={(v) => updateItem('courses', c.id, { program: v })} />
          <RichField label="Description" value={c.description} onChange={(v) => updateItem('courses', c.id, { description: v })} />
          <DualField label="Short description (summary mode)" value={c.short_description ?? {}} onChange={(v) => updateItem('courses', c.id, { short_description: v })} summarizeFrom={c.description} placeholder="One concise line shown in summary mode" />
          <FieldRow>
            <DateField label="From" value={c.start} onChange={(v) => updateItem('courses', c.id, { start: v })} />
            <DateField label="To" value={c.end} onChange={(v) => updateItem('courses', c.id, { end: v })} allowOngoing />
            <CategorySelect value={c.category} onChange={(v) => updateItem('courses', c.id, { category: v })} />
          </FieldRow>
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
      <SortBar section="certifications" />
      <SortableList section="certifications" ids={items.map((x) => x.id)} addLabel="Add certification" onAdd={add}>
      {items.map((c) => (
        <EditorCard key={c.id} section="certifications" id={c.id}
          title={resolve(c.name, primaryLocale)} subtitle={resolve(c.organiser, primaryLocale)}
          meta={fmtDate(c.issued)} preview={richToPlain(resolve(c.description, primaryLocale))}
          starred={c.starred} disabled={c.disabled}>
          <DualField label="Certification" value={c.name} onChange={(v) => updateItem('certifications', c.id, { name: v })} />
          <DualField label="Issuing organisation" value={c.organiser} onChange={(v) => updateItem('certifications', c.id, { organiser: v })} />
          <RichField label="Description" value={c.description} onChange={(v) => updateItem('certifications', c.id, { description: v })} />
          <DualField label="Short description (summary mode)" value={c.short_description ?? {}} onChange={(v) => updateItem('certifications', c.id, { short_description: v })} summarizeFrom={c.description} placeholder="One concise line shown in summary mode" />
          <FieldRow>
            <DateField label="Issued" value={c.issued} onChange={(v) => updateItem('certifications', c.id, { issued: v })} />
            <DateField label="Expires" value={c.expires} onChange={(v) => updateItem('certifications', c.id, { expires: v })} allowOngoing />
            <CategorySelect value={c.category} onChange={(v) => updateItem('certifications', c.id, { category: v })} />
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
      start: null, end: null, role_ids: [], skill_tags: [], sort_order: items.length, starred: false, disabled: false,
    }
    addItem('positions', p)
  }
  return (
    <div className="section-pane">
      <SectionIntro>
        Board memberships, advisory roles, volunteer work, and other
        engagements outside of paid employment.
      </SectionIntro>
      <SortBar section="positions" />
      <SortableList section="positions" ids={items.map((x) => x.id)} addLabel="Add role" onAdd={add}>
      {items.map((p) => (
        <EditorCard key={p.id} section="positions" id={p.id}
          title={resolve(p.organisation, primaryLocale) || resolve(p.name, primaryLocale)}
          subtitle={[resolve(p.name, primaryLocale), positionTypeLabel(p.position_type)].filter(Boolean).join(' · ')}
          meta={fmtRange(p.start, p.end)} preview={richToPlain(resolve(p.description, primaryLocale))}
          starred={p.starred} disabled={p.disabled}>
          <DualField label="Position / role" value={p.name} onChange={(v) => updateItem('positions', p.id, { name: v })} />
          <DualField label="Organisation" value={p.organisation} onChange={(v) => updateItem('positions', p.id, { organisation: v })} />
          <RoleTypeLinks roleIds={p.role_ids ?? []} hint="— link a registry role type so this engagement feeds that role's years of experience"
            onChange={(ids) => updateItem('positions', p.id, { role_ids: ids })} />
          <RichField label="Description" value={p.description} onChange={(v) => updateItem('positions', p.id, { description: v })} />
          <DualField label="Short description (summary mode)" value={p.short_description ?? {}} onChange={(v) => updateItem('positions', p.id, { short_description: v })} summarizeFrom={p.description} placeholder="One concise line shown in summary mode" />
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
      // New presentations default the "To" date to today and leave "From" blank;
      // a talk given once needs only "To", a recurring one carries both.
      url: null, date: null, start: null, end: thisMonth(),
      skill_tags: [], sort_order: items.length, starred: false, disabled: false,
    }
    addItem('presentations', p)
  }
  return (
    <div className="section-pane">
      <SectionIntro>
        Talks, conference sessions and workshops you have delivered — internal or
        public. Give a single date under "To", or a From/To range for a talk
        held regularly over a period.
      </SectionIntro>
      <SortBar section="presentations" />
      <SortableList section="presentations" ids={items.map((x) => x.id)} addLabel="Add presentation" onAdd={add}>
      {items.map((p) => (
        <EditorCard key={p.id} section="presentations" id={p.id}
          title={resolve(p.title, primaryLocale)} subtitle={resolve(p.event, primaryLocale)}
          meta={fmtRange(p.start, p.end)} preview={richToPlain(resolve(p.description, primaryLocale))}
          starred={p.starred} disabled={p.disabled}>
          <DualField label="Title" value={p.title} onChange={(v) => updateItem('presentations', p.id, { title: v })} />
          <DualField label="Event / venue" value={p.event} onChange={(v) => updateItem('presentations', p.id, { event: v })} />
          <RichField label="Abstract" value={p.description} onChange={(v) => updateItem('presentations', p.id, { description: v })} />
          <DualField label="Short description (summary mode)" value={p.short_description ?? {}} onChange={(v) => updateItem('presentations', p.id, { short_description: v })} summarizeFrom={p.description} placeholder="One concise line shown in summary mode" />
          <FieldRow>
            <DateField label="From" value={p.start} onChange={(v) => updateItem('presentations', p.id, { start: v })} />
            <DateField label="To" value={p.end} onChange={(v) => updateItem('presentations', p.id, { end: v })} allowOngoing />
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
      <SortBar section="publications" />
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
          <DualField label="Short description (summary mode)" value={p.short_description ?? {}} onChange={(v) => updateItem('publications', p.id, { short_description: v })} summarizeFrom={p.abstract} placeholder="One concise line shown in summary mode" />
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
      <SortBar section="honor_awards" />
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
          <DualField label="Short description (summary mode)" value={a.short_description ?? {}} onChange={(v) => updateItem('honor_awards', a.id, { short_description: v })} summarizeFrom={a.description} placeholder="One concise line shown in summary mode" />
          <DateField label="Date" value={a.date} onChange={(v) => updateItem('honor_awards', a.id, { date: v })} />
        </EditorCard>
      ))}
      </SortableList>
    </div>
  )
}

// ── Spoken languages ─────────────────────────────────────────────────────────

/** Europass CEFR self-assessment grid — one A1–C2 dropdown per skill category. */
function LanguageCefrEditor({ lang }: { lang: SpokenLanguage }) {
  const updateItem = useStore((s) => s.updateItem)
  const setLevel = (cat: CefrCategory, level: string) => {
    const next = { ...(lang.cefr ?? {}) }
    if (level) next[cat] = level as CefrLevel
    else delete next[cat]
    updateItem('spoken_languages', lang.id, { cefr: Object.keys(next).length ? next : undefined })
  }
  return (
    <div className="sub-block">
      <div className="sub-head">Europass language passport <span className="sub-hint">CEFR self-assessment (A1–C2)</span></div>
      <div className="cefr-grid">
        {CEFR_CATEGORIES.map((c) => (
          <label key={c.key} className="cefr-field">
            <span className="cefr-cat">{c.label}</span>
            <select className="cefr-select" value={lang.cefr?.[c.key] ?? ''} onChange={(e) => setLevel(c.key, e.target.value)} aria-label={`${c.label} CEFR level`}>
              <option value="">—</option>
              {CEFR_LEVELS.map((lv) => <option key={lv} value={lv} title={CEFR_LEVEL_DESC[lv]}>{lv}</option>)}
            </select>
          </label>
        ))}
      </div>
      <ul className="cefr-legend">
        {CEFR_LEVELS.map((lv) => <li key={lv}><strong>{lv}</strong> — {CEFR_LEVEL_DESC[lv]}</li>)}
      </ul>
      <style>{`
        .cefr-grid { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-bottom: 8px; }
        .cefr-field { display: flex; flex-direction: column; gap: 3px; }
        .cefr-cat { font-size: 11px; font-weight: 600; color: var(--ink-faint); }
        .cefr-select { padding: 5px 8px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--paper); min-width: 74px; }
        .cefr-legend { margin: 4px 0 0; padding-left: 16px; font-size: 11px; color: var(--ink-faint); line-height: 1.5; }
        .cefr-legend strong { color: var(--ink-soft); }
      `}</style>
    </div>
  )
}

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
        Fluent, or Working knowledge. Add Europass CEFR levels for a language
        passport in exports.
      </SectionIntro>
      <SortBar section="spoken_languages" />
      <SortableList section="spoken_languages" ids={items.map((x) => x.id)} addLabel="Add language" onAdd={add}>
      {items.map((l) => (
        <EditorCard key={l.id} section="spoken_languages" id={l.id}
          title={resolve(l.name, primaryLocale)}
          subtitle={[resolve(l.level, primaryLocale), cefrSummary(l.cefr)].filter(Boolean).join(' · ')}
          disabled={l.disabled} canStar={false}>
          <DualField label="Language" value={l.name} onChange={(v) => updateItem('spoken_languages', l.id, { name: v })} />
          <DualField label="Proficiency level" value={l.level} onChange={(v) => updateItem('spoken_languages', l.id, { level: v })} />
          <LanguageCefrEditor lang={l} />
        </EditorCard>
      ))}
      </SortableList>
    </div>
  )
}

// ── Key competencies ───────────────────────────────────────────────────────

/**
 * The three competency inputs (title, description, short summary). Shared by the
 * Key Competencies library editor AND the per-profile bundle editor so both
 * surfaces edit the exact same fields (one source of truth).
 */
function CompetencyFields({ competency: k }: { competency: KeyCompetency }) {
  const updateItem = useStore((s) => s.updateItem)
  return (
    <>
      <DualField label="Competency" value={k.title} onChange={(v) => updateItem('key_competencies', k.id, { title: v })} placeholder="e.g. Solution architecture" />
      <RichField label="Description" value={k.description} onChange={(v) => updateItem('key_competencies', k.id, { description: v })} />
      <DualField label="Short description (summary mode)" value={k.short_description ?? {}} onChange={(v) => updateItem('key_competencies', k.id, { short_description: v })} summarizeFrom={k.description} placeholder="One concise line shown in summary mode" />
    </>
  )
}

/** Profiles (bundles) that include competency `id`, in profile order. */
function bundlesContaining(quals: KeyQualification[], id: string): KeyQualification[] {
  return quals.filter((q) => (q.competency_ids ?? []).includes(id))
}

/**
 * Read/navigate grouping of the competency library BY PROFILE — each profile's
 * bundle listed under its tag line, plus an "Unassigned" group for competencies
 * in no profile. A competency in several profiles appears once under EACH (the
 * point of the view). Chips open the competency in a lightbox to edit; membership
 * itself is edited on the Profile page. Mirrors the registries' "By category".
 */
function CompetenciesByProfile({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, primaryLocale } = useStore()
  const byId = new Map(data.key_competencies.map((c) => [c.id, c]))
  const inSome = new Set<string>()
  const groups = data.key_qualifications.filter((q) => !q.disabled).map((p) => {
    const comps = (p.competency_ids ?? [])
      .map((id) => byId.get(id))
      .filter((c): c is KeyCompetency => !!c && !c.disabled)
    comps.forEach((c) => inSome.add(c.id))
    return { id: p.id, label: resolve(p.tag_line, primaryLocale) || '(unnamed profile)', comps }
  })
  const unassigned = data.key_competencies.filter((c) => !c.disabled && !inSome.has(c.id))

  const chip = (c: KeyCompetency) => (
    <button key={c.id} type="button" className="kcp-chip" onClick={() => onOpen(c.id)} title="Click to edit">
      {resolve(c.title, primaryLocale) || 'Untitled competency'}
    </button>
  )

  return (
    <div className="kcp">
      {groups.map((g) => (
        <div key={g.id} className="kcp-group">
          <div className="kcp-head">{g.label} <span className="kcp-count">{g.comps.length}</span></div>
          <div className="kcp-chips">
            {g.comps.length === 0
              ? <span className="kcp-empty">No competencies — add them from this profile on the Profile page.</span>
              : g.comps.map(chip)}
          </div>
        </div>
      ))}
      {unassigned.length > 0 && (
        <div className="kcp-group">
          <div className="kcp-head kcp-head-un">Unassigned <span className="kcp-count">{unassigned.length}</span></div>
          <div className="kcp-chips">{unassigned.map(chip)}</div>
        </div>
      )}
      {groups.length === 0 && unassigned.length === 0 && (
        <p className="kcp-empty" style={{ padding: '4px 2px' }}>No competencies yet.</p>
      )}
    </div>
  )
}

export function KeyCompetenciesEditor() {
  const { data, primaryLocale, addItem } = useStore()
  const items = useSortedItems('key_competencies')
  const [byProfile, setByProfile] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const add = () => {
    const k: KeyCompetency = {
      id: newId(), resume_id: data.resume!.id, title: {}, description: {},
      sort_order: items.length, starred: false, disabled: false,
    }
    addItem('key_competencies', k)
  }
  // In the by-profile view there are no inline cards — create then open the
  // competency in the lightbox to edit it.
  const addAndEdit = () => {
    const k: KeyCompetency = {
      id: newId(), resume_id: data.resume!.id, title: {}, description: {},
      sort_order: items.length, starred: false, disabled: false,
    }
    addItem('key_competencies', k, { open: false })
    setEditingId(k.id)
  }
  const editing = editingId ? data.key_competencies.find((c) => c.id === editingId) ?? null : null
  const editingBundles = editing ? bundlesContaining(data.key_qualifications, editing.id) : []

  return (
    <div className="section-pane">
      <SectionIntro>
        Your headline strengths — each a short heading with a supporting
        description. Group them into profiles on the Profile page: a Resume View
        shows exactly the competencies of the profile it presents. This page is
        the full library of every competency.
      </SectionIntro>

      <div className="kc-toolbar">
        <div className="kc-viewtoggle" role="group" aria-label="Key competencies view">
          <button type="button" className={byProfile ? '' : 'is-active'} aria-pressed={!byProfile} onClick={() => setByProfile(false)}>List</button>
          <button type="button" className={byProfile ? 'is-active' : ''} aria-pressed={byProfile} onClick={() => setByProfile(true)}>By profile</button>
        </div>
        {byProfile && (
          <button type="button" className="kc-add" onClick={addAndEdit}><Plus size={14} /> Add competency</button>
        )}
      </div>

      {byProfile ? (
        <CompetenciesByProfile onOpen={setEditingId} />
      ) : (
        <>
          <SortBar section="key_competencies" />
          <SortableList section="key_competencies" ids={items.map((x) => x.id)} addLabel="Add competency" onAdd={add}>
          {items.map((k) => {
            const bundles = bundlesContaining(data.key_qualifications, k.id)
            const inLabel = bundles.length
              ? `In: ${bundles.map((q) => resolve(q.tag_line, primaryLocale) || '(unnamed profile)').join(', ')}`
              : 'Not in any profile'
            return (
            <EditorCard key={k.id} section="key_competencies" id={k.id}
              title={resolve(k.title, primaryLocale) || 'Competency'}
              subtitle={inLabel}
              preview={richToPlain(resolve(k.description, primaryLocale))}
              starred={k.starred} disabled={k.disabled}>
              <CompetencyFields competency={k} />
              <p className="kc-bundles" role="note">
                {bundles.length
                  ? <>Belongs to {bundles.length === 1 ? 'profile' : 'profiles'}: <strong>{bundles.map((q) => resolve(q.tag_line, primaryLocale) || '(unnamed profile)').join(', ')}</strong>. Manage membership on the Profile page.</>
                  : <>Not yet in any profile — add it from a profile on the Profile page to have it appear in a view.</>}
              </p>
            </EditorCard>
            )
          })}
          </SortableList>
        </>
      )}

      {editing && (
        <RegistryLightbox
          title={resolve(editing.title, primaryLocale) || 'Competency'}
          ariaLabel="Edit competency"
          onClose={() => setEditingId(null)}
        >
          <CompetencyFields competency={editing} />
          <p className="kc-bundles" role="note">
            {editingBundles.length
              ? <>Belongs to: <strong>{editingBundles.map((q) => resolve(q.tag_line, primaryLocale) || '(unnamed profile)').join(', ')}</strong>. Manage membership on the Profile page.</>
              : <>Not in any profile — add it from a profile on the Profile page to have it appear in a view.</>}
          </p>
        </RegistryLightbox>
      )}

      <style>{`
        .kc-bundles { margin: 4px 2px 0; font-size: 12px; color: var(--ink-soft); }
        .kc-bundles strong { color: var(--ink); font-weight: 600; }
        .kc-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
        .kc-viewtoggle { display: inline-flex; border: 1px solid var(--line-strong); border-radius: var(--r-md); overflow: hidden; }
        .kc-viewtoggle button { border: none; background: var(--paper); padding: 6px 14px; font-size: 13px; font-weight: 600; color: var(--ink-soft); cursor: pointer; }
        .kc-viewtoggle button + button { border-left: 1px solid var(--line-strong); }
        .kc-viewtoggle button.is-active { background: var(--accent); color: #fff; }
        .kc-add { display: inline-flex; align-items: center; gap: 5px; padding: 6px 11px; border: 1px solid var(--accent); border-radius: var(--r-sm); background: var(--accent-wash); color: var(--accent); font-size: 13px; font-weight: 600; cursor: pointer; }
        .kc-add:hover { background: var(--accent); color: #fff; }
        .kcp { display: flex; flex-direction: column; gap: 14px; }
        .kcp-group { border: 1px solid var(--line); border-radius: var(--r-md); background: var(--paper-raised); overflow: hidden; }
        .kcp-head { padding: 8px 12px; background: var(--paper-sunken); border-bottom: 1px solid var(--line); font-size: 13px; font-weight: 700; color: var(--ink); }
        .kcp-head-un { color: var(--ink-soft); font-style: italic; }
        .kcp-count { display: inline-block; margin-left: 4px; font-size: 11.5px; font-weight: 600; color: var(--ink-faint); }
        .kcp-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px; }
        .kcp-chip { border: 1px solid var(--line-strong); border-radius: 999px; background: var(--paper); padding: 4px 12px; font-size: 12.5px; font-weight: 500; color: var(--ink); cursor: pointer; }
        .kcp-chip:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-wash); }
        .kcp-empty { font-size: 12.5px; color: var(--ink-faint); font-style: italic; }
      `}</style>
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
      <SortBar section="recommendations" />
      <SortableList section="recommendations" ids={items.map((x) => x.id)} addLabel="Add recommendation" onAdd={add}>
      {items.map((r) => (
        <EditorCard key={r.id} section="recommendations" id={r.id}
          title={r.recommender_name || 'Recommendation'}
          subtitle={[
            [resolve(r.recommender_title, primaryLocale), r.recommender_company].filter(Boolean).join(', '),
            resolve(r.relationship, primaryLocale) && `(${resolve(r.relationship, primaryLocale)})`,
          ].filter(Boolean).join(' ')}
          meta={fmtDate(r.date)} preview={richToPlain(resolve(r.text, primaryLocale))}
          starred={r.starred} disabled={r.disabled}>
          <FieldRow>
            <DateField label="Date received" value={r.date} onChange={(v) => updateItem('recommendations', r.id, { date: v })} />
            <TextField label="Source" value={r.source || ''} onChange={(v) => updateItem('recommendations', r.id, { source: v || null })} placeholder="e.g. LinkedIn" />
            <TextField label="Link" value={r.contact_url || ''} onChange={(v) => updateItem('recommendations', r.id, { contact_url: v || null })} />
          </FieldRow>
          <RichField label="Testimonial" value={r.text} onChange={(v) => updateItem('recommendations', r.id, { text: v })} />
          <DualField label="Short description (summary mode)" value={r.short_description ?? {}} onChange={(v) => updateItem('recommendations', r.id, { short_description: v })} summarizeFrom={r.text} placeholder="One concise line shown in summary mode" />
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

/**
 * One draggable competency row inside a profile bundle. Mirrors the EditorCard
 * grip pattern (useSortable) so the bundle can be reordered by drag; the up/down
 * buttons stay as the accessible, non-pointer fallback.
 */
function SortableCompetencyRow({
  competency: c, index, count, isOpen, primaryLocale, otherBundleLabels,
  onToggle, onMove, onRemove,
}: {
  competency: KeyCompetency
  index: number
  count: number
  isOpen: boolean
  primaryLocale: string
  otherBundleLabels: string[]
  onToggle: () => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: c.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1,
  }
  return (
    <li ref={setNodeRef} style={style} className={`pcb-item ${isDragging ? 'is-dragging' : ''}`}>
      <div className="pcb-row">
        <button type="button" className="pcb-grip" {...attributes} {...listeners}
          title="Drag to reorder" aria-label="Drag competency to reorder">
          <GripVertical size={14} />
        </button>
        <button type="button" className="pcb-title" aria-expanded={isOpen} onClick={onToggle}>
          {isOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} style={{ transform: 'rotate(90deg)' }} />}
          <span>{resolve(c.title, primaryLocale) || 'Untitled competency'}</span>
        </button>
        <div className="pcb-actions">
          <button type="button" className="pcb-icon" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}><ChevronUp size={15} /></button>
          <button type="button" className="pcb-icon" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}><ChevronDown size={15} /></button>
          <button type="button" className="pcb-icon pcb-remove" aria-label="Remove from profile" onClick={onRemove}><X size={15} /></button>
        </div>
      </div>
      {isOpen && (
        <div className="pcb-fields">
          <CompetencyFields competency={c} />
          {otherBundleLabels.length > 0 && (
            <p className="pcb-shared" role="note">
              Also used by: {otherBundleLabels.join(', ')}. Edits apply everywhere.
            </p>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * The "bundle" editor inside a profile card: the ordered set of competencies
 * this profile presents. A view showing this profile shows exactly these, in
 * this order. Create new competencies, pull in existing ones (reuse across
 * profiles), reorder (drag handle OR up/down buttons), or remove (removing only
 * unlinks — the competency stays in the library). Membership lives on the
 * profile (`competency_ids`).
 */
function ProfileBundleEditor({ kq }: { kq: KeyQualification }) {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [addingExisting, setAddingExisting] = useState(false)
  // Ids ticked in the "Add existing" multi-select panel (batch add).
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const ids = kq.competency_ids ?? []
  const byId = new Map(data.key_competencies.map((c) => [c.id, c]))
  const members = ids.map((id) => byId.get(id)).filter((c): c is KeyCompetency => !!c)
  const available = data.key_competencies.filter((c) => !c.disabled && !ids.includes(c.id))

  // A dnd context local to this bundle — reorders `competency_ids`, independent
  // of the outer Profiles SortableList (nested dnd-kit contexts are fine; each
  // grip only activates its own). Same sensor config as SortableList.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const setIds = (next: string[]) => updateItem('key_qualifications', kq.id, { competency_ids: next })

  const addNew = () => {
    const c: KeyCompetency = {
      id: newId(), resume_id: data.resume!.id, title: {}, description: {},
      sort_order: data.key_competencies.length, starred: false, disabled: false,
    }
    // Create the competency without stealing focus from this profile card, then
    // append it to the bundle and open it inline for editing.
    addItem('key_competencies', c, { open: false })
    setIds([...ids, c.id])
    setExpanded(c.id)
  }

  const move = (id: string, dir: -1 | 1) => {
    const i = ids.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    const next = [...ids]
    ;[next[i], next[j]] = [next[j], next[i]]
    setIds(next)
  }

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    setIds(arrayMove(ids, from, to))
  }

  return (
    <div className="pcb">
      <div className="pcb-head">
        <span className="pf-label" style={{ margin: 0 }}>Competencies in this profile</span>
        <span className="pcb-hint">Shown, in this order, by any view that presents this profile. Drag to reorder.</span>
      </div>

      {members.length === 0 && <p className="pcb-empty">No competencies yet — add one below.</p>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="pcb-list">
            {members.map((c, i) => (
              <SortableCompetencyRow
                key={c.id}
                competency={c}
                index={i}
                count={members.length}
                isOpen={expanded === c.id}
                primaryLocale={primaryLocale}
                otherBundleLabels={bundlesContaining(data.key_qualifications, c.id)
                  .filter((q) => q.id !== kq.id)
                  .map((q) => resolve(q.tag_line, primaryLocale) || '(unnamed profile)')}
                onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
                onMove={(dir) => move(c.id, dir)}
                onRemove={() => setIds(ids.filter((x) => x !== c.id))}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="pcb-add">
        <button type="button" className="pcb-addbtn" onClick={addNew}><Plus size={14} /> Add competency</button>
        {available.length > 0 && !addingExisting && (
          <button type="button" className="pcb-addbtn pcb-addbtn-alt"
            onClick={() => { setPicked(new Set()); setAddingExisting(true) }}>Add existing…</button>
        )}
      </div>

      {addingExisting && (
        <div className="pcb-existing" role="group" aria-label="Add existing competencies to this profile">
          <div className="pcb-existing-head">
            <span>Add existing competencies</span>
            <span className="pcb-existing-tools">
              <button type="button" onClick={() => setPicked(new Set(available.map((c) => c.id)))}>All</button>
              <button type="button" onClick={() => setPicked(new Set())}>None</button>
            </span>
          </div>
          <ul className="pcb-existing-list">
            {available.map((c) => {
              const inBundles = bundlesContaining(data.key_qualifications, c.id)
                .map((q) => resolve(q.tag_line, primaryLocale) || '(unnamed profile)')
              return (
                <li key={c.id}>
                  <label className="pcb-existing-row">
                    <input type="checkbox" checked={picked.has(c.id)}
                      onChange={() => setPicked((prev) => {
                        const next = new Set(prev)
                        next.has(c.id) ? next.delete(c.id) : next.add(c.id)
                        return next
                      })} />
                    <span className="pcb-existing-title">{resolve(c.title, primaryLocale) || 'Untitled competency'}</span>
                    {inBundles.length > 0 && <span className="pcb-existing-in">in {inBundles.join(', ')}</span>}
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="pcb-existing-actions">
            <button type="button" className="pcb-addbtn" disabled={picked.size === 0}
              onClick={() => {
                // Preserve library order; append the ticked ones not already in the bundle.
                const add = available.filter((c) => picked.has(c.id)).map((c) => c.id)
                setIds([...ids, ...add])
                setAddingExisting(false)
                setPicked(new Set())
              }}>
              Add selected ({picked.size})
            </button>
            <button type="button" className="pcb-cancel" onClick={() => setAddingExisting(false)}>Cancel</button>
          </div>
        </div>
      )}

      <style>{`
        .pcb { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
        .pcb-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
        .pcb-hint { font-size: 12px; color: var(--ink-faint); }
        .pcb-empty { margin: 8px 2px; font-size: 13px; color: var(--ink-soft); }
        .pcb-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .pcb-item { border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--paper-raised); }
        .pcb-item.is-dragging { box-shadow: var(--shadow-md); border-color: var(--secondary-line); }
        .pcb-row { display: flex; align-items: center; gap: 6px; padding: 6px 8px; }
        .pcb-grip { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 26px; border: none; background: none; color: var(--ink-faint); cursor: grab; touch-action: none; }
        .pcb-grip:hover { color: var(--ink-soft); }
        .pcb-grip:active { cursor: grabbing; }
        .pcb-title { flex: 1; display: flex; align-items: center; gap: 6px; background: none; border: none; padding: 2px; text-align: left; cursor: pointer; color: var(--ink); font: inherit; font-size: 13px; }
        .pcb-title:hover { color: var(--accent); }
        .pcb-actions { display: flex; gap: 2px; }
        .pcb-icon { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px solid transparent; border-radius: var(--r-sm); background: none; color: var(--ink-soft); cursor: pointer; }
        .pcb-icon:hover:not(:disabled) { background: var(--paper-sunken); color: var(--ink); }
        .pcb-icon:disabled { opacity: 0.35; cursor: default; }
        .pcb-remove:hover:not(:disabled) { color: var(--err-ink); background: var(--err-wash); }
        .pcb-fields { padding: 4px 10px 12px; border-top: 1px solid var(--line); }
        .pcb-shared { margin: 8px 0 0; font-size: 12px; color: var(--ink-soft); }
        .pcb-add { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
        .pcb-addbtn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border: 1px solid var(--accent); border-radius: var(--r-sm); background: var(--accent-wash); color: var(--accent); font-size: 13px; font-weight: 600; cursor: pointer; }
        .pcb-addbtn:hover { background: var(--accent); color: #fff; }
        .pcb-addbtn-alt { border-color: var(--line-strong); background: none; color: var(--ink-soft); font-weight: 500; }
        .pcb-addbtn-alt:hover { background: var(--paper-sunken); color: var(--ink); }
        .pcb-cancel { background: none; border: none; color: var(--ink-soft); font-size: 12px; cursor: pointer; text-decoration: underline; }
        .pcb-existing { margin-top: 10px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--paper); overflow: hidden; }
        .pcb-existing-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; background: var(--paper-sunken); border-bottom: 1px solid var(--line); font-size: 12px; font-weight: 600; color: var(--ink-soft); }
        .pcb-existing-tools { display: inline-flex; gap: 4px; }
        .pcb-existing-tools button { border: 1px solid var(--line-strong); border-radius: var(--r-sm); background: var(--paper); font-size: 11.5px; font-weight: 600; padding: 2px 8px; color: var(--ink-soft); cursor: pointer; }
        .pcb-existing-tools button:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-wash); }
        .pcb-existing-list { list-style: none; margin: 0; padding: 4px; max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }
        .pcb-existing-row { display: flex; align-items: center; gap: 8px; padding: 5px 7px; border-radius: var(--r-sm); cursor: pointer; font-size: 13px; }
        .pcb-existing-row:hover { background: var(--paper-sunken); }
        .pcb-existing-title { color: var(--ink); }
        .pcb-existing-in { color: var(--ink-faint); font-size: 11.5px; }
        .pcb-existing-actions { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-top: 1px solid var(--line); }
        .pcb-addbtn:disabled { opacity: 0.5; cursor: default; }
        .pcb-addbtn:disabled:hover { background: var(--accent-wash); color: var(--accent); }
      `}</style>
    </div>
  )
}

export function ProfileEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = useSortedItems('key_qualifications')
  const add = () => {
    const k: KeyQualification = {
      id: newId(), resume_id: data.resume!.id, label: {}, tag_line: {}, summary: {},
      key_points: [], skill_tags: [], competency_ids: [], sort_order: items.length, starred: false, disabled: false, internal_notes: null,
    }
    addItem('key_qualifications', k)
    // A view shows exactly ONE profile. So a new profile must not silently
    // appear in views that already picked a different one — exclude it from
    // every existing view (the user opts a view into it explicitly). This keeps
    // each view's selection sticky when profiles are added.
    for (const v of data.views) {
      if (!v.excluded_item_ids.includes(k.id)) {
        updateItem('views', v.id, { excluded_item_ids: [...v.excluded_item_ids, k.id] })
      }
    }
  }

  // Per-KQ key_points are deprecated UI: the standalone "Key Competencies"
  // section owns those now (see migrate.extractKeyPointsToCompetencies +
  // KeyCompetenciesEditor). The Profile block stays focused on the prose
  // summary and tag line.
  return (
    <div className="section-pane">
      <SectionIntro>
        The opening statement of your CV — a tag line plus a short and a long
        summary, together with the <strong>key competencies</strong> this
        profile presents. The tag line names the profile and, by default,
        becomes the resume title in each view. Each Resume View picks one
        profile and shows exactly its competencies, in the order set here, so a
        compact view can lead with the short summary and a detailed one with the
        long. Add several profiles and pick one per view.
      </SectionIntro>
      <SortBar section="key_qualifications" />
      <SortableList section="key_qualifications" ids={items.map((x) => x.id)} addLabel="Add profile" onAdd={add}>
      {items.map((kq) => (
        <EditorCard key={kq.id} section="key_qualifications" id={kq.id}
          title={resolve(kq.tag_line, primaryLocale) || 'Profile'}
          preview={richToPlain(resolve(kq.summary, primaryLocale))}
          starred={kq.starred} disabled={kq.disabled}>
          <DualField label="Tag line" value={kq.tag_line} onChange={(v) => updateItem('key_qualifications', kq.id, { tag_line: v })} placeholder="e.g. Senior Cloud Architect" />
          <RichField label="Short summary (summary mode)" value={kq.summary_short ?? {}} onChange={(v) => updateItem('key_qualifications', kq.id, { summary_short: v })} />
          <RichField label="Full profile (full mode)" value={kq.summary} onChange={(v) => updateItem('key_qualifications', kq.id, { summary: v })} />
          <ProfileBundleEditor kq={kq} />
        </EditorCard>
      ))}
      </SortableList>
    </div>
  )
}

// (.check-row styling now lives in src/index.css)
