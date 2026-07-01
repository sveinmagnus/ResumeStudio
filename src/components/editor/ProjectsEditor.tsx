import { useState } from 'react'
import { useStore, newId } from '../../store/useStore'
import { useSortedItems } from '../../store/useSortedItems'
import { suggestSkillNames } from '../../lib/skillTaxonomy'
import { DualField } from '../ui/DualField'
import { RichField } from '../ui/RichField'
import { TextField, DateField, TagField } from '../ui/Fields'
import { EditorCard, AddButton, FieldRow } from '../ui/EditorCard'
import { SortableList } from '../ui/SortableList'
import { SortBar } from '../ui/SortBar'
import { Autocomplete } from '../ui/Autocomplete'
import { SkillTranslationPopover, TranslationPopover } from './RegistryEditors'
import { resolve, fmtRange } from '../../lib/locales'
import { richToPlain } from '../../lib/richText'
import type { Project, ProjectRole, ProjectIndustry, ProjectSkill, Skill, Industry, Role, LocalizedString } from '../../types'
import { Plus, X } from 'lucide-react'

export function ProjectsEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const projects = useSortedItems('projects')

  const allTags = [...new Set(data.projects.flatMap((p) => p.skill_tags))]

  const addProject = () => {
    const p: Project = {
      id: newId(), resume_id: data.resume!.id, work_experience_id: null,
      customer: {}, customer_anonymized: {}, use_anonymized: false, industries: [],
      description: {}, long_description: {}, highlights: [], roles: [], skills: [],
      start: null, end: null, percent_allocated: null, team_size: null,
      location_country_code: null, external_url: null, skill_tags: [],
      sort_order: projects.length, starred: false, disabled: false, internal_notes: null,
    }
    addItem('projects', p)
  }

  return (
    <div className="section-pane">
      <SortBar section="projects" count={projects.length} />
      <AddButton label="Add project" onClick={addProject} />
      <SortableList section="projects" ids={projects.map((p) => p.id)}>
      {projects.map((p) => (
        <EditorCard key={p.id} section="projects" id={p.id}
          title={resolve(p.customer, primaryLocale) || resolve(p.description, primaryLocale)}
          subtitle={resolve(p.description, primaryLocale)}
          meta={fmtRange(p.start, p.end)}
          preview={richToPlain(resolve(p.long_description, primaryLocale))}
          starred={p.starred} disabled={p.disabled}>

          <DualField label="Customer" value={p.customer} onChange={(v) => updateItem('projects', p.id, { customer: v })} />
          <DualField label="Description (short)" value={p.description} onChange={(v) => updateItem('projects', p.id, { description: v })} />
          <ProjectIndustriesEditor project={p} />
          <RichField label="Description" value={p.long_description} onChange={(v) => updateItem('projects', p.id, { long_description: v })} />

          <FieldRow>
            <DateField label="Start" value={p.start} onChange={(v) => updateItem('projects', p.id, { start: v })} />
            <DateField label="End" value={p.end} onChange={(v) => updateItem('projects', p.id, { end: v })} allowOngoing />
            <TextField label="Allocation %" value={p.percent_allocated?.toString() || ''} type="number"
              onChange={(v) => updateItem('projects', p.id, { percent_allocated: v ? parseInt(v) : null })} />
            <TextField label="Team size" value={p.team_size?.toString() || ''} type="number"
              onChange={(v) => updateItem('projects', p.id, { team_size: v ? parseInt(v) : null })} />
          </FieldRow>

          <HighlightsEditor project={p} />
          <ProjectRolesEditor project={p} />
          <ProjectSkillsEditor project={p} />

          <TextField label="External case-study URL" value={p.external_url || ''} onChange={(v) => updateItem('projects', p.id, { external_url: v })} />
          <TagField label="Skill tags (for targeting)" tags={p.skill_tags} suggestions={allTags}
            onChange={(t) => updateItem('projects', p.id, { skill_tags: t })} />
        </EditorCard>
      ))}
      </SortableList>
      <PaneStyles />
    </div>
  )
}

// ── Highlights (localized bullet list) ──────────────────────────────────────

function HighlightsEditor({ project }: { project: Project }) {
  const { updateItem, primaryLocale, secondaryLocale } = useStore()

  const update = (idx: number, locale: string, text: string) => {
    const next = project.highlights.map((h, i) => {
      if (i !== idx) return h
      const copy = { ...h }
      if (text) copy[locale] = text; else delete copy[locale]
      return copy
    })
    updateItem('projects', project.id, { highlights: next })
  }
  const add = () => updateItem('projects', project.id, { highlights: [...project.highlights, {}] })
  const remove = (idx: number) => updateItem('projects', project.id, { highlights: project.highlights.filter((_, i) => i !== idx) })

  return (
    <div className="sub-block">
      <div className="sub-head">Highlights <span className="sub-hint">key achievements as bullets</span></div>
      {project.highlights.map((h, i) => (
        <div key={i} className="hl-row">
          <div className={`hl-inputs ${secondaryLocale ? 'dual' : ''}`}>
            <input className="hl-input" value={h[primaryLocale] || ''} placeholder="Achievement…"
              onChange={(e) => update(i, primaryLocale, e.target.value)} />
            {secondaryLocale && (
              <input className="hl-input hl-sec" value={h[secondaryLocale] || ''} placeholder="…"
                onChange={(e) => update(i, secondaryLocale, e.target.value)} />
            )}
          </div>
          <button className="hl-del" onClick={() => remove(i)} aria-label="Remove highlight" title="Remove highlight"><X size={14} /></button>
        </div>
      ))}
      <button className="sub-add" onClick={add}><Plus size={13} /> Add highlight</button>
    </div>
  )
}

// ── Project industries (multi-link into the shared Industry registry) ────────

/**
 * Links a project to one or MORE industries (shape v4), mirroring the project
 * skills/roles UX: chips for the linked industries (click a chip to edit its
 * dual-language registry name via the shared popover) plus a typeahead to link
 * an existing industry or create a new one. "shared registry" — merge
 * duplicates in the Industry Registry.
 */
function ProjectIndustriesEditor({ project }: { project: Project }) {
  const { data, addItem, updateItem, primaryLocale } = useStore()

  const remove = (piId: string) =>
    updateItem('projects', project.id, { industries: project.industries.filter((pi) => pi.id !== piId) })

  const linkExisting = (industryId: string) => {
    if (project.industries.some((pi) => pi.industry_id === industryId)) return
    const ind = data.industries.find((i) => i.id === industryId)
    if (!ind) return
    const pi: ProjectIndustry = { id: newId(), industry_id: ind.id, name: ind.name, sort_order: project.industries.length }
    updateItem('projects', project.id, { industries: [...project.industries, pi] })
  }

  const createAndLink = (text: string) => {
    const ind: Industry = {
      id: newId(), resume_id: data.resume!.id,
      name: { [primaryLocale]: text },
      sort_order: data.industries.length, disabled: false,
    }
    // open:false so creating the industry doesn't collapse this project card.
    addItem('industries', ind, { open: false })
    const pi: ProjectIndustry = { id: newId(), industry_id: ind.id, name: ind.name, sort_order: project.industries.length }
    const current = useStore.getState().data.projects.find((p) => p.id === project.id)
    if (!current) return
    updateItem('projects', project.id, { industries: [...current.industries, pi] })
  }

  return (
    <div className="sub-block">
      <div className="sub-head">Industries <span className="sub-hint">shared registry — click a chip to edit its translation; merge duplicates in the Industry Registry</span></div>
      <div className="skill-chip-list">
        {project.industries.map((pi) => (
          <ProjectIndustryChip key={pi.id} project={project} pi={pi} onRemove={() => remove(pi.id)} />
        ))}
      </div>
      <Autocomplete
        options={data.industries
          .filter((i) => !i.disabled && !project.industries.some((pi) => pi.industry_id === i.id))
          .map((i) => ({ id: i.id, label: resolve(i.name, primaryLocale) || '(unnamed industry)' }))}
        onPick={linkExisting}
        onAddNew={createAndLink}
        addLabel="industry"
        placeholder="Search or add an industry…"
      />
    </div>
  )
}

/**
 * A ProjectIndustry chip mirroring ProjectRoleChip. Clicking opens a
 * dual-language popover editing the registry Industry name (propagates to every
 * reference); for a stale link with no registry entry it edits the local
 * snapshot name.
 */
function ProjectIndustryChip({ project, pi, onRemove }: { project: Project; pi: ProjectIndustry; onRemove: () => void }) {
  const { data, primaryLocale, updateItem } = useStore()
  const [open, setOpen] = useState(false)
  const industry = data.industries.find((i) => i.id === pi.industry_id)
  const label = resolve(industry?.name ?? pi.name, primaryLocale) || '(unnamed industry)'

  const onChangeName = (name: LocalizedString) => {
    if (industry) updateItem('industries', industry.id, { name })
    else updateItem('projects', project.id, { industries: project.industries.map((x) => (x.id === pi.id ? { ...x, name } : x)) })
  }

  return (
    <div className="skill-chip-w">
      <button type="button" className="skill-chip" onClick={() => setOpen((o) => !o)} title="Edit translation">
        <span>{label}</span>
      </button>
      <button type="button" className="skill-chip-x" onClick={(e) => { e.stopPropagation(); onRemove() }} title="Remove from this project">
        <X size={12} />
      </button>
      {open && (
        <TranslationPopover
          title={`Edit “${label}” translation`}
          fieldLabel="Industry name"
          value={industry?.name ?? pi.name}
          footnote={industry ? 'Changes the registry — all references update.' : 'Not linked to the registry.'}
          onClose={() => setOpen(false)}
          onChange={onChangeName}
        />
      )}
    </div>
  )
}

// ── Project roles ────────────────────────────────────────────────────────────

function ProjectRolesEditor({ project }: { project: Project }) {
  const { data, addItem, updateItem, primaryLocale } = useStore()

  const remove = (rid: string) => updateItem('projects', project.id, { roles: project.roles.filter((r) => r.id !== rid) })

  // Link an existing registry role. Skips silently if already attached.
  const linkExisting = (roleId: string) => {
    if (project.roles.some((r) => r.role_id === roleId)) return
    const reg = data.roles.find((x) => x.id === roleId)
    if (!reg) return
    // Snapshot the registry name (both languages) so picking fills both fields.
    const role: ProjectRole = { id: newId(), role_id: roleId, name: reg.name, sort_order: project.roles.length, disabled: false }
    updateItem('projects', project.id, { roles: [...project.roles, role] })
  }

  // Create a brand-new registry role from typed text, then attach it — mirrors
  // ProjectSkillsEditor.createAndLink so roles and skills behave identically.
  const createAndLink = (text: string) => {
    const reg: Role = {
      id: newId(), resume_id: data.resume!.id,
      name: { [primaryLocale]: text },
      years_of_experience: 0, years_of_experience_offset: 0,
      starred: false, sort_order: data.roles.length, disabled: false,
    }
    addItem('roles', reg, { open: false }) // don't collapse this project card
    const pr: ProjectRole = { id: newId(), role_id: reg.id, name: reg.name, sort_order: project.roles.length, disabled: false }
    const current = useStore.getState().data.projects.find((p) => p.id === project.id)
    if (!current) return
    updateItem('projects', project.id, { roles: [...current.roles, pr] })
  }

  return (
    <div className="sub-block">
      <div className="sub-head">Roles on this project <span className="sub-hint">linked to the role registry — click a chip to edit its translation</span></div>
      <div className="skill-chip-list">
        {project.roles.map((r) => (
          <ProjectRoleChip key={r.id} project={project} pr={r} onRemove={() => remove(r.id)} />
        ))}
      </div>
      <Autocomplete
        options={data.roles
          .filter((reg) => !reg.disabled && !project.roles.some((pr) => pr.role_id === reg.id))
          .map((reg) => ({ id: reg.id, label: resolve(reg.name, primaryLocale) || '(unnamed role)' }))}
        onPick={linkExisting}
        onAddNew={createAndLink}
        addLabel="role"
        placeholder="Search or add a role…"
      />
    </div>
  )
}

/**
 * A ProjectRole chip mirroring ProjectSkillChip. Clicking opens a dual-language
 * popover: when linked to a registry Role it edits the registry name (so the
 * change propagates to every reference); for a legacy free-text role (no
 * registry link) it edits the project's local snapshot name.
 */
function ProjectRoleChip({ project, pr, onRemove }: { project: Project; pr: ProjectRole; onRemove: () => void }) {
  const { data, primaryLocale, updateItem } = useStore()
  const [open, setOpen] = useState(false)
  const role = pr.role_id ? data.roles.find((x) => x.id === pr.role_id) : null
  const label = resolve(role?.name ?? pr.name, primaryLocale) || '(unnamed role)'

  const onChangeName = (name: LocalizedString) => {
    if (role) updateItem('roles', role.id, { name })
    else updateItem('projects', project.id, { roles: project.roles.map((r) => (r.id === pr.id ? { ...r, name } : r)) })
  }

  return (
    <div className="skill-chip-w">
      <button type="button" className="skill-chip" onClick={() => setOpen((o) => !o)} title="Edit translation">
        <span>{label}</span>
      </button>
      <button type="button" className="skill-chip-x" onClick={(e) => { e.stopPropagation(); onRemove() }} title="Remove from this project">
        <X size={12} />
      </button>
      {open && (
        <TranslationPopover
          title={`Edit “${label}” translation`}
          fieldLabel="Role name"
          value={role?.name ?? pr.name}
          footnote={role ? 'Changes the registry — all references update.' : 'Free-text role — not linked to the registry.'}
          onClose={() => setOpen(false)}
          onChange={onChangeName}
        />
      )}
    </div>
  )
}

// ── Project skills ───────────────────────────────────────────────────────────

function ProjectSkillsEditor({ project }: { project: Project }) {
  const { data, addItem, updateItem, primaryLocale } = useStore()

  const remove = (sid: string) => updateItem('projects', project.id, { skills: project.skills.filter((s) => s.id !== sid) })

  // Link an existing registry skill to the project. Skips silently if the
  // skill is already attached (same `skill_id` already present).
  const linkExisting = (skillId: string) => {
    if (project.skills.some((s) => s.skill_id === skillId)) return
    const reg = data.skills.find((x) => x.id === skillId)
    if (!reg) return
    const skill: ProjectSkill = {
      id: newId(), skill_id: skillId, name: reg.name,
      duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0,
      sort_order: project.skills.length,
    }
    updateItem('projects', project.id, { skills: [...project.skills, skill] })
  }

  // Create a brand-new registry skill from typed text, then immediately
  // attach it to this project. Mirrors how CategorySkillChip handles the
  // same flow inside TechCategoriesEditor.
  const createAndLink = (text: string) => {
    const reg: Skill = {
      id: newId(), resume_id: data.resume!.id,
      name: { [primaryLocale]: text },
      default_category: null, skill_type: 'technical',
      total_duration_in_years: 0, proficiency: 0,
      is_highlighted: false, created_at: new Date().toISOString(),
    }
    addItem('skills', reg, { open: false }) // don't collapse this project card
    const ps: ProjectSkill = {
      id: newId(), skill_id: reg.id, name: reg.name,
      duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0,
      sort_order: project.skills.length,
    }
    // Read the current state via the store rather than the stale `project`
    // closure so we don't lose the just-added skill if another mutation
    // races in.
    const current = useStore.getState().data.projects.find((p) => p.id === project.id)
    if (!current) return
    updateItem('projects', project.id, { skills: [...current.skills, ps] })
  }

  return (
    <div className="sub-block">
      <div className="sub-head">Skills used <span className="sub-hint">linked to global registry — click a chip to edit its translation</span></div>
      <div className="skill-chip-list">
        {project.skills.map((s) => (
          <ProjectSkillChip key={s.id} ps={s} onRemove={() => remove(s.id)} />
        ))}
      </div>
      <Autocomplete
        options={data.skills
          .filter((reg) => !project.skills.some((ps) => ps.skill_id === reg.id))
          .map((reg) => ({
            id: reg.id,
            label: resolve(reg.name, primaryLocale) || '(unnamed skill)',
            sublabel: reg.skill_type,
          }))}
        onPick={linkExisting}
        onAddNew={createAndLink}
        addLabel="skill"
        placeholder="Search or add a skill…"
        suggestExtra={suggestSkillNames(() =>
          useStore.getState().data.skills.map((s) => resolve(s.name, primaryLocale)),
        )}
      />
    </div>
  )
}

/**
 * A ProjectSkill chip. Clicking opens a popover with a DualField bound to
 * the GLOBAL registry Skill so editing the translation here updates every
 * other reference too (which is the consultant's natural expectation:
 * "TypeScript" should mean the same thing everywhere). The chip's own
 * snapshot is re-derived from the registry name on every render.
 */
function ProjectSkillChip({ ps, onRemove }: { ps: ProjectSkill; onRemove: () => void }) {
  const { data, primaryLocale, updateItem } = useStore()
  const [open, setOpen] = useState(false)
  const skill = data.skills.find((x) => x.id === ps.skill_id)
  const label = resolve(skill?.name ?? ps.name, primaryLocale) || '(unlinked)'

  return (
    <div className="skill-chip-w">
      <button
        type="button"
        className="skill-chip"
        onClick={() => setOpen((o) => !o)}
        title="Edit translation"
      >
        <span>{label}</span>
      </button>
      <button
        type="button"
        className="skill-chip-x"
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        title="Remove from this project"
      >
        <X size={12} />
      </button>
      {open && skill && (
        <SkillTranslationPopover
          skill={skill}
          onClose={() => setOpen(false)}
          onChange={(name) => updateItem('skills', skill.id, { name })}
        />
      )}
    </div>
  )
}

function PaneStyles() {
  return (
    <style>{`
      .sub-block { margin: 16px 0; padding: 14px; background: var(--paper-sunken); border-radius: var(--r-md); }
      .sub-head { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 10px; }
      .sub-hint { font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--ink-faint); margin-left: 6px; }
      .hl-row { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 7px; }
      .hl-inputs { flex: 1; display: grid; gap: 8px; }
      .hl-inputs.dual { grid-template-columns: 1fr 1fr; }
      .hl-input { padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--paper-raised); }
      .hl-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash); }
      .hl-input.hl-sec { background: var(--secondary-tint); border-color: var(--secondary-line); }
      .hl-del { width: 30px; height: 34px; display: grid; place-items: center; color: var(--ink-faint); border-radius: var(--r-sm); flex-shrink: 0; }
      .hl-del:hover { background: var(--accent-wash); color: var(--accent); }
      .sub-add { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; font-size: 13px; font-weight: 600; color: var(--accent); border-radius: var(--r-sm); }
      .sub-add:hover { background: var(--accent-wash); }
      .skill-chip-list { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 10px; }
      .skill-chip-w { position: relative; display: inline-flex; align-items: center; background: var(--paper-raised); border: 1px solid var(--line); border-radius: 20px; padding: 2px 6px 2px 2px; }
      .skill-chip-w:hover { border-color: var(--accent); }
      .skill-chip { padding: 4px 10px; font-size: 13px; font-weight: 500; background: transparent; cursor: pointer; }
      .skill-chip:hover { color: var(--accent); }
      .skill-chip-x { width: 20px; height: 20px; display: grid; place-items: center; color: var(--ink-faint); border-radius: 50%; }
      .skill-chip-x:hover { background: var(--accent-wash); color: var(--accent); }
      .section-pane { animation: fadeUp .35s ease; }
      .editor-block { margin-bottom: 26px; }
      .eb-title { font-size: 20px; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
    `}</style>
  )
}
