import { useState, useMemo, useRef, useEffect } from 'react'
import { useStore, newId } from '../../store/useStore'
import { useSortedItems } from '../../store/useSortedItems'
import { DualField } from '../ui/DualField'
import { TextField } from '../ui/Fields'
import { EditorCard, AddButton, FieldRow } from '../ui/EditorCard'
import { SortableList } from '../ui/SortableList'
import { SortBar } from '../ui/SortBar'
import { Autocomplete } from '../ui/Autocomplete'
import { resolve, fmtRange } from '../../lib/locales'
import {
  mergeSkills, mergeRoles, countSkillReferences, countRoleReferences,
} from '../../lib/merge'
import { usageOfSkill, usageOfRole, isSkillUnused, isRoleUnused } from '../../lib/usage'
import type {
  Skill, Role, Reference, TechnologyCategory, CategorySkill,
  LocalizedString, Project, WorkExperience,
} from '../../types'
import { X, Combine, Filter as FilterIcon, Briefcase, FolderKanban } from 'lucide-react'

// ── Shared registry-filter bar ──────────────────────────────────────────────

type RegistryFilter = 'all' | 'unused' | 'missing-translation'

function FilterBar({
  filter, onChange, counts,
}: {
  filter: RegistryFilter
  onChange: (f: RegistryFilter) => void
  counts: { all: number; unused: number; missing: number }
}) {
  const Btn = ({ value, label, count }: { value: RegistryFilter; label: string; count: number }) => (
    <button
      type="button"
      className={`fb-btn ${filter === value ? 'active' : ''}`}
      onClick={() => onChange(value)}
      aria-pressed={filter === value}
    >
      {label} <span className="fb-count">{count}</span>
    </button>
  )
  return (
    <div className="fb-wrap">
      <FilterIcon size={13} className="fb-icon" />
      <Btn value="all" label="All" count={counts.all} />
      <Btn value="unused" label="Unused" count={counts.unused} />
      <Btn value="missing-translation" label="Missing translation" count={counts.missing} />
      <style>{`
        .fb-wrap {
          display: flex; align-items: center; gap: 6px; margin-bottom: 14px;
          padding: 8px 10px; background: var(--paper-sunken); border-radius: var(--r-md);
        }
        .fb-icon { color: var(--ink-faint); margin-right: 2px; }
        .fb-btn {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 10px; font-size: 12.5px; font-weight: 600;
          color: var(--ink-soft); background: transparent;
          border: 1px solid transparent; border-radius: var(--r-sm);
          transition: all .12s; cursor: pointer;
        }
        .fb-btn:hover { background: var(--paper-raised); }
        .fb-btn.active {
          background: var(--paper-raised); color: var(--accent);
          border-color: var(--accent);
        }
        .fb-count {
          font-size: 11px; font-weight: 700; padding: 1px 6px;
          border-radius: 999px; background: var(--paper-sunken); color: var(--ink-faint);
        }
        .fb-btn.active .fb-count { background: var(--accent-wash); color: var(--accent); }
      `}</style>
    </div>
  )
}

/**
 * "Missing translation" = the registry entry has content in the primary
 * locale but not in the active secondary locale. When no secondary is set
 * we treat nothing as missing (the user has explicitly hidden the second
 * column, so there's no translation goal to chase).
 */
function isMissingTranslation(
  ls: LocalizedString,
  primary: string,
  secondary: string | null,
): boolean {
  if (!secondary) return false
  const p = (ls[primary] ?? '').trim()
  const s = (ls[secondary] ?? '').trim()
  return !!p && !s
}

// ── Skill registry ───────────────────────────────────────────────────────────

export function SkillsEditor() {
  const { data, primaryLocale, secondaryLocale, addItem, updateItem, replaceData } = useStore()
  const [filter, setFilter] = useState<RegistryFilter>('all')

  const allItems = useMemo(
    () => [...data.skills].sort(
      (a, b) => resolve(a.name, primaryLocale).localeCompare(resolve(b.name, primaryLocale)),
    ),
    [data.skills, primaryLocale],
  )

  // Usage spans projects AND technology categories — countSkillReferences
  // already enumerates every reference site, so reuse it rather than an
  // inline scan that would silently miss the tech-category branch.
  const usage = useMemo(
    () => new Map(allItems.map((s) => [s.id, countSkillReferences(data, s.id)])),
    [allItems, data],
  )

  const counts = useMemo(() => {
    let unused = 0
    let missing = 0
    for (const s of allItems) {
      if ((usage.get(s.id) ?? 0) === 0) unused++
      if (isMissingTranslation(s.name, primaryLocale, secondaryLocale)) missing++
    }
    return { all: allItems.length, unused, missing }
  }, [allItems, usage, primaryLocale, secondaryLocale])

  const items = useMemo(() => {
    if (filter === 'unused') return allItems.filter((s) => (usage.get(s.id) ?? 0) === 0)
    if (filter === 'missing-translation') {
      return allItems.filter((s) => isMissingTranslation(s.name, primaryLocale, secondaryLocale))
    }
    return allItems
  }, [allItems, usage, filter, primaryLocale, secondaryLocale])

  const onMerge = (sourceId: string, targetId: string) => {
    if (!confirmMerge('skill', sourceId, targetId, data.skills, primaryLocale, countSkillReferences(data, sourceId))) return
    // replaceData (not loadStore) so the merge enters the undo stack and is
    // picked up by the auto-save effect.
    replaceData(mergeSkills(data, sourceId, targetId))
  }

  const add = () => {
    const s: Skill = {
      id: newId(), resume_id: data.resume!.id, name: {}, default_category: null,
      skill_type: 'technical', total_duration_in_years: 0, proficiency: 0, is_highlighted: false, created_at: new Date().toISOString(),
    }
    addItem('skills', s)
  }
  return (
    <div className="section-pane">
      <p className="registry-note">
        Skills live here once and are referenced by projects and the skills showcase.
        Total experience is computed from linked projects.
      </p>
      <FilterBar filter={filter} onChange={setFilter} counts={counts} />
      {items.length === 0 && (
        <div className="registry-empty">
          {filter === 'unused'
            ? 'No unused skills — every skill is referenced somewhere.'
            : filter === 'missing-translation'
              ? 'No skills are missing a translation in the secondary language.'
              : 'No skills yet — add your first below.'}
        </div>
      )}
      {items.map((s) => {
        const u = usageOfSkill(data, s.id)
        const projectCount = u.projects.length
        const catCount = u.technology_categories.length
        return (
          <EditorCard key={s.id} section="skills" id={s.id}
            title={resolve(s.name, primaryLocale)}
            subtitle={s.skill_type}
            meta={`${projectCount} project${projectCount === 1 ? '' : 's'} | ${catCount} categor${catCount === 1 ? 'y' : 'ies'}`}
            canStar={false} canDisable={false}
            sortable={false}>
            <DualField label="Skill name" value={s.name} onChange={(v) => updateItem('skills', s.id, { name: v })} />
            <FieldRow>
              <div className="pf-wrap">
                <label className="pf-label">Type</label>
                <select className="pf-input" value={s.skill_type}
                  onChange={(e) => updateItem('skills', s.id, { skill_type: e.target.value as Skill['skill_type'] })}>
                  <option value="technical">Technical</option>
                  <option value="methodology">Methodology</option>
                  <option value="domain">Domain</option>
                  <option value="soft">Soft skill</option>
                </select>
              </div>
              <div className="pf-wrap">
                <label className="pf-label">Proficiency (0–5)</label>
                <input className="pf-input" type="number" min={0} max={5} value={s.proficiency}
                  onChange={(e) => updateItem('skills', s.id, { proficiency: parseInt(e.target.value) || 0 })} />
              </div>
              <TextField label="Total years" value={s.total_duration_in_years.toFixed(1)}
                onChange={(v) => updateItem('skills', s.id, { total_duration_in_years: parseFloat(v) || 0 })} />
            </FieldRow>
            <label className="check-row">
              <input type="checkbox" checked={s.is_highlighted} onChange={(e) => updateItem('skills', s.id, { is_highlighted: e.target.checked })} />
              Highlight in compact skill summaries
            </label>
            <SkillUsagePanel projects={u.projects} categories={u.technology_categories} />
            <MergeRow
              kind="skill"
              sourceId={s.id}
              allItems={allItems.filter((x) => x.id !== s.id).map((x) => ({ id: x.id, label: resolve(x.name, primaryLocale) }))}
              onMerge={onMerge}
            />
          </EditorCard>
        )
      })}
      <AddButton label="Add skill" onClick={add} />
      <RegistryStyles />
    </div>
  )
}

// ── Role registry ────────────────────────────────────────────────────────────

export function RolesEditor() {
  const { data, primaryLocale, secondaryLocale, addItem, updateItem, replaceData } = useStore()
  const [filter, setFilter] = useState<RegistryFilter>('all')

  const sortedItems = useSortedItems('roles')

  const usage = useMemo(
    () => new Map(sortedItems.map((r) => [r.id, countRoleReferences(data, r.id)])),
    [sortedItems, data],
  )

  const counts = useMemo(() => {
    let unused = 0
    let missing = 0
    for (const r of sortedItems) {
      if ((usage.get(r.id) ?? 0) === 0) unused++
      if (isMissingTranslation(r.name, primaryLocale, secondaryLocale)) missing++
    }
    return { all: sortedItems.length, unused, missing }
  }, [sortedItems, usage, primaryLocale, secondaryLocale])

  const items = useMemo(() => {
    if (filter === 'unused') return sortedItems.filter((r) => (usage.get(r.id) ?? 0) === 0)
    if (filter === 'missing-translation') {
      return sortedItems.filter((r) => isMissingTranslation(r.name, primaryLocale, secondaryLocale))
    }
    return sortedItems
  }, [sortedItems, usage, filter, primaryLocale, secondaryLocale])

  const add = () => {
    const r: Role = {
      id: newId(), resume_id: data.resume!.id, name: {}, years_of_experience: 0,
      years_of_experience_offset: 0, starred: false, sort_order: sortedItems.length, disabled: false,
    }
    addItem('roles', r)
  }

  const onMerge = (sourceId: string, targetId: string) => {
    if (!confirmMerge('role', sourceId, targetId, data.roles, primaryLocale, countRoleReferences(data, sourceId))) return
    replaceData(mergeRoles(data, sourceId, targetId))
  }
  return (
    <div className="section-pane">
      <p className="registry-note">Reusable role labels referenced by projects and employments. "Solution Architect" is defined once here.</p>
      <FilterBar filter={filter} onChange={setFilter} counts={counts} />
      <SortBar section="roles" count={sortedItems.length} />
      {/* SortableList only wraps the rendered slice; reordering with a filter
          active still bakes into sort_order against the visible items, which
          is the intuitive behaviour. */}
      <SortableList section="roles" ids={items.map((x) => x.id)}>
      {items.length === 0 && (
        <div className="registry-empty">
          {filter === 'unused'
            ? 'No unused roles — every role is referenced somewhere.'
            : filter === 'missing-translation'
              ? 'No roles are missing a translation in the secondary language.'
              : 'No roles yet — add your first below.'}
        </div>
      )}
      {items.map((r) => {
        const u = usageOfRole(data, r.id)
        const projectCount = u.projects.length
        const empCount = u.work_experiences.length
        return (
          <EditorCard key={r.id} section="roles" id={r.id}
            title={resolve(r.name, primaryLocale)}
            meta={`${projectCount} project${projectCount === 1 ? '' : 's'} | ${empCount} employment${empCount === 1 ? '' : 's'}`}
            starred={r.starred} disabled={r.disabled}>
            <DualField label="Role name" value={r.name} onChange={(v) => updateItem('roles', r.id, { name: v })} />
            <FieldRow>
              <TextField label="Years of experience" value={r.years_of_experience.toString()} type="number"
                onChange={(v) => updateItem('roles', r.id, { years_of_experience: parseFloat(v) || 0 })} />
              <TextField label="Manual offset (±)" value={r.years_of_experience_offset.toString()} type="number"
                onChange={(v) => updateItem('roles', r.id, { years_of_experience_offset: parseFloat(v) || 0 })} />
            </FieldRow>
            <RoleUsagePanel projects={u.projects} employments={u.work_experiences} />
            <MergeRow
              kind="role"
              sourceId={r.id}
              allItems={sortedItems.filter((x) => x.id !== r.id).map((x) => ({ id: x.id, label: resolve(x.name, primaryLocale) }))}
              onMerge={onMerge}
            />
          </EditorCard>
        )
      })}
      </SortableList>
      <AddButton label="Add role" onClick={add} />
      <RegistryStyles />
    </div>
  )
}

// ── Usage panels ────────────────────────────────────────────────────────────

/**
 * Shared "where is this used" panel embedded inside a registry card. Clicking
 * a usage row navigates the editor to that section and expands the item.
 */
function UsageRow({
  icon, label, onClick,
}: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" className="ur-row" onClick={onClick}>
      <span className="ur-icon">{icon}</span>
      <span className="ur-label">{label}</span>
    </button>
  )
}

function SkillUsagePanel({
  projects, categories,
}: { projects: Project[]; categories: TechnologyCategory[] }) {
  const { primaryLocale, setActiveSection, setExpandedItem } = useStore()
  const goto = (section: string, id: string) => {
    setActiveSection(section)
    setExpandedItem(id)
  }
  if (projects.length === 0 && categories.length === 0) {
    return (
      <div className="usage-block usage-empty">
        <strong>Unused</strong> — no projects or technology categories reference this skill yet.
      </div>
    )
  }
  return (
    <div className="usage-block">
      <div className="usage-head">Used in</div>
      {projects.length > 0 && (
        <>
          <div className="usage-sub">{projects.length} project{projects.length === 1 ? '' : 's'}</div>
          {projects.map((p) => (
            <UsageRow
              key={p.id}
              icon={<FolderKanban size={13} />}
              label={`${resolve(p.customer, primaryLocale) || resolve(p.description, primaryLocale) || 'Untitled project'} ${fmtRange(p.start, p.end) ? '· ' + fmtRange(p.start, p.end) : ''}`.trim()}
              onClick={() => goto('projects', p.id)}
            />
          ))}
        </>
      )}
      {categories.length > 0 && (
        <>
          <div className="usage-sub">{categories.length} categor{categories.length === 1 ? 'y' : 'ies'}</div>
          {categories.map((c) => (
            <UsageRow
              key={c.id}
              icon={<FolderKanban size={13} />}
              label={resolve(c.name, primaryLocale) || 'Untitled category'}
              onClick={() => goto('technology_categories', c.id)}
            />
          ))}
        </>
      )}
    </div>
  )
}

function RoleUsagePanel({
  projects, employments,
}: { projects: Project[]; employments: WorkExperience[] }) {
  const { primaryLocale, setActiveSection, setExpandedItem } = useStore()
  const goto = (section: string, id: string) => {
    setActiveSection(section)
    setExpandedItem(id)
  }
  if (projects.length === 0 && employments.length === 0) {
    return (
      <div className="usage-block usage-empty">
        <strong>Unused</strong> — no projects or employments reference this role yet.
      </div>
    )
  }
  return (
    <div className="usage-block">
      <div className="usage-head">Used in</div>
      {projects.length > 0 && (
        <>
          <div className="usage-sub">{projects.length} project{projects.length === 1 ? '' : 's'}</div>
          {projects.map((p) => (
            <UsageRow
              key={p.id}
              icon={<FolderKanban size={13} />}
              label={`${resolve(p.customer, primaryLocale) || resolve(p.description, primaryLocale) || 'Untitled project'} ${fmtRange(p.start, p.end) ? '· ' + fmtRange(p.start, p.end) : ''}`.trim()}
              onClick={() => goto('projects', p.id)}
            />
          ))}
        </>
      )}
      {employments.length > 0 && (
        <>
          <div className="usage-sub">{employments.length} employment{employments.length === 1 ? '' : 's'}</div>
          {employments.map((w) => (
            <UsageRow
              key={w.id}
              icon={<Briefcase size={13} />}
              label={`${resolve(w.employer, primaryLocale) || 'Untitled employer'} ${fmtRange(w.start, w.end) ? '· ' + fmtRange(w.start, w.end) : ''}`.trim()}
              onClick={() => goto('work_experiences', w.id)}
            />
          ))}
        </>
      )}
    </div>
  )
}

// ── Reusable merge UI ───────────────────────────────────────────────────────

/**
 * Show the per-merge confirmation dialog. Returns true if the user accepted
 * AND the merge has a valid (different, both-present) source/target pair.
 */
function confirmMerge(
  kind: 'skill' | 'role',
  sourceId: string,
  targetId: string,
  registry: ReadonlyArray<{ id: string; name: LocalizedString }>,
  locale: string,
  refs: number,
): boolean {
  if (!targetId || sourceId === targetId) return false
  const source = registry.find((x) => x.id === sourceId)
  const target = registry.find((x) => x.id === targetId)
  if (!source || !target) return false
  const sName = resolve(source.name, locale) || `(unnamed ${kind})`
  const tName = resolve(target.name, locale) || `(unnamed ${kind})`
  const plural = refs === 1 ? '' : 's'
  return confirm(
    `Merge "${sName}" into "${tName}"? This will rewrite ${refs} reference${plural} and delete "${sName}".`,
  )
}

interface MergeOption { id: string; label: string }

function MergeRow({
  kind, sourceId, allItems, onMerge,
}: {
  kind: 'skill' | 'role'
  sourceId: string
  allItems: MergeOption[]
  onMerge: (sourceId: string, targetId: string) => void
}) {
  if (allItems.length === 0) return null
  return (
    <div className="merge-row">
      <Combine size={13} />
      <span className="merge-label">Merge this {kind} into:</span>
      <select
        className="merge-sel"
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value
          // reset the select so the same target can be re-attempted if needed
          e.target.value = ''
          if (v) onMerge(sourceId, v)
        }}
      >
        <option value="">— pick a target —</option>
        {allItems
          .filter((x) => x.label.trim())
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
      </select>
      <style>{`
        .merge-row {
          display: flex; align-items: center; gap: 8px; margin-top: 14px;
          padding: 10px 12px; background: var(--accent-wash); border-radius: var(--r-sm);
          font-size: 12.5px; color: var(--accent);
        }
        .merge-label { font-weight: 600; }
        .merge-sel {
          flex: 1; padding: 5px 9px; border: 1px solid var(--accent);
          border-radius: var(--r-sm); background: #fff; font-size: 12.5px;
        }
      `}</style>
    </div>
  )
}

// ── References ───────────────────────────────────────────────────────────────

export function ReferencesEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = data.references
  const add = () => {
    const ref: Reference = {
      id: newId(), resume_id: data.resume!.id, name: '', title: null, company: null,
      relationship: {}, email: null, phone: null, linkedin_url: null,
      project_id: null, work_experience_id: null, include_in_exports: false, internal_notes: null,
    }
    addItem('references', ref)
  }
  return (
    <div className="section-pane">
      <p className="registry-note">References are private by default and never appear in exports unless you opt in per reference.</p>
      {items.map((ref) => (
        <EditorCard key={ref.id} section="references" id={ref.id}
          title={ref.name || 'New reference'} subtitle={[ref.title, ref.company].filter(Boolean).join(', ')}
          canStar={false} canDisable={false}
          sortable={false}>
          <FieldRow>
            <TextField label="Name" value={ref.name} onChange={(v) => updateItem('references', ref.id, { name: v })} />
            <TextField label="Title" value={ref.title || ''} onChange={(v) => updateItem('references', ref.id, { title: v })} />
            <TextField label="Company" value={ref.company || ''} onChange={(v) => updateItem('references', ref.id, { company: v })} />
          </FieldRow>
          <DualField label="Relationship" value={ref.relationship} onChange={(v) => updateItem('references', ref.id, { relationship: v })} />
          <FieldRow>
            <TextField label="Email" value={ref.email || ''} onChange={(v) => updateItem('references', ref.id, { email: v })} />
            <TextField label="Phone" value={ref.phone || ''} onChange={(v) => updateItem('references', ref.id, { phone: v })} />
          </FieldRow>
          <ReferenceContextLink reference={ref} />
          <label className="check-row">
            <input type="checkbox" checked={ref.include_in_exports} onChange={(e) => updateItem('references', ref.id, { include_in_exports: e.target.checked })} />
            Include this reference in exports
          </label>
        </EditorCard>
      ))}
      <AddButton label="Add reference" onClick={add} />
      <RegistryStyles />
      {/* .check-row styling lives in src/index.css */}
    </div>
  )
}

/**
 * Reference → project / employment link. The Reference type carries both
 * `project_id` and `work_experience_id` (independent slots, since a single
 * person may have recommended you on a project that doesn't map to a
 * specific employment). This UI unifies them into a single autocomplete
 * that searches across both pools and stores the picked id in the
 * appropriate slot. Picking from "projects" clears any work_experience_id
 * and vice versa, so the two never disagree.
 */
function ReferenceContextLink({ reference }: { reference: Reference }) {
  const { data, primaryLocale, updateItem, setActiveSection, setExpandedItem } = useStore()

  const linked = reference.project_id
    ? data.projects.find((p) => p.id === reference.project_id)
    : reference.work_experience_id
      ? data.work_experiences.find((w) => w.id === reference.work_experience_id)
      : null
  const linkedKind: 'project' | 'employment' | null = reference.project_id
    ? 'project'
    : reference.work_experience_id
      ? 'employment'
      : null

  // Build the unified option list. Each option's label is the customer /
  // employer line; the sublabel adds the role / project title and date
  // range so the user can disambiguate two projects at the same customer.
  const options = useMemo(() => {
    const out: { id: string; label: string; sublabel?: string; kind: 'project' | 'employment' }[] = []
    for (const p of data.projects) {
      const customer = resolve(p.customer, primaryLocale)
      const desc = resolve(p.description, primaryLocale)
      const range = fmtRange(p.start, p.end)
      const label = customer || desc || 'Untitled project'
      const subParts = [desc && desc !== label ? desc : null, range].filter(Boolean) as string[]
      out.push({ id: `p:${p.id}`, label: `📁 ${label}`, sublabel: subParts.join(' · ') || undefined, kind: 'project' })
    }
    for (const w of data.work_experiences) {
      const employer = resolve(w.employer, primaryLocale)
      const title = resolve(w.role_title, primaryLocale)
      const range = fmtRange(w.start, w.end)
      const label = employer || title || 'Untitled employment'
      const subParts = [title && title !== label ? title : null, range].filter(Boolean) as string[]
      out.push({ id: `w:${w.id}`, label: `💼 ${label}`, sublabel: subParts.join(' · ') || undefined, kind: 'employment' })
    }
    return out
  }, [data.projects, data.work_experiences, primaryLocale])

  const pick = (compositeId: string) => {
    const [kind, id] = compositeId.split(':')
    if (kind === 'p') {
      updateItem('references', reference.id, { project_id: id, work_experience_id: null })
    } else if (kind === 'w') {
      updateItem('references', reference.id, { project_id: null, work_experience_id: id })
    }
  }
  const unlink = () => updateItem('references', reference.id, { project_id: null, work_experience_id: null })

  const linkedLabel = (() => {
    if (!linked) return ''
    if (linkedKind === 'project') {
      const p = linked as Project
      return `${resolve(p.customer, primaryLocale) || resolve(p.description, primaryLocale) || 'Untitled project'}`
    }
    const w = linked as WorkExperience
    return `${resolve(w.employer, primaryLocale) || resolve(w.role_title, primaryLocale) || 'Untitled employment'}`
  })()

  return (
    <div className="rcl-wrap">
      <label className="rcl-label">Project or employment <span className="rcl-hint">— what was this person involved with?</span></label>
      {linked ? (
        <div className="rcl-linked">
          <button
            type="button"
            className="rcl-pill"
            onClick={() => {
              setActiveSection(linkedKind === 'project' ? 'projects' : 'work_experiences')
              setExpandedItem((linked as { id: string }).id)
            }}
            title="Open the linked item"
          >
            {linkedKind === 'project' ? <FolderKanban size={13} /> : <Briefcase size={13} />}
            {linkedLabel}
          </button>
          <button type="button" className="rcl-unlink" onClick={unlink} title="Remove the link">
            <X size={13} /> Unlink
          </button>
        </div>
      ) : (
        <Autocomplete
          options={options.map(({ id, label, sublabel }) => ({ id, label, sublabel }))}
          onPick={pick}
          placeholder="Search projects and employments by name…"
          addLabel="link"
        />
      )}
      <style>{`
        .rcl-wrap { margin-bottom: 14px; }
        .rcl-label {
          display: block; font-size: 11px; font-weight: 600; letter-spacing: .08em;
          text-transform: uppercase; color: var(--ink-faint); margin-bottom: 7px;
        }
        .rcl-hint { font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--ink-faint); margin-left: 2px; }
        .rcl-linked { display: flex; align-items: center; gap: 8px; }
        .rcl-pill {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 5px 11px; background: var(--accent-wash); color: var(--accent);
          border-radius: 999px; font-size: 13px; font-weight: 600;
          border: none; cursor: pointer;
        }
        .rcl-pill:hover { background: var(--accent); color: #fff; }
        .rcl-unlink {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 4px 10px; font-size: 12px; color: var(--ink-faint);
          border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--paper);
        }
        .rcl-unlink:hover { color: var(--accent); border-color: var(--accent); }
      `}</style>
    </div>
  )
}

// ── Technology categories (skills showcase) ───────────────────────────────────

export function TechCategoriesEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = useSortedItems('technology_categories')

  const add = () => {
    const c: TechnologyCategory = {
      id: newId(), resume_id: data.resume!.id, name: {}, skills: [], sort_order: items.length, disabled: false,
    }
    addItem('technology_categories', c)
  }

  // Link a registry skill to the category. If `existingCsId` is provided we
  // replace an existing row; otherwise we append a new one.
  const linkSkillIntoCategory = (catId: string, skillId: string, existingCsId?: string) => {
    const cat = items.find((x) => x.id === catId)!
    const reg = data.skills.find((x) => x.id === skillId)
    if (!reg) return
    // Don't link the same skill twice into a category — silently surface the
    // existing chip instead.
    if (cat.skills.some((cs) => cs.skill_id === skillId && cs.id !== existingCsId)) return
    if (existingCsId) {
      updateItem('technology_categories', catId, {
        skills: cat.skills.map((cs) => (cs.id === existingCsId
          ? { ...cs, skill_id: skillId, name: reg.name, total_duration_in_years: reg.total_duration_in_years || 0 }
          : cs)),
      })
    } else {
      const cs: CategorySkill = {
        id: newId(), skill_id: skillId, name: reg.name, proficiency: 0,
        total_duration_in_years: reg.total_duration_in_years || 0, sort_order: cat.skills.length,
      }
      updateItem('technology_categories', catId, { skills: [...cat.skills, cs] })
    }
  }

  const createSkillAndLink = (catId: string, text: string) => {
    const skill: Skill = {
      id: newId(), resume_id: data.resume!.id, name: { [primaryLocale]: text },
      default_category: null, skill_type: 'technical', total_duration_in_years: 0,
      proficiency: 0, is_highlighted: false, created_at: new Date().toISOString(),
    }
    addItem('skills', skill)
    // Pull the freshly-current category off `items` after addItem (which
    // committed via the store): use a microtask so we read the updated state.
    // Simpler: read directly via getState.
    const cat = useStore.getState().data.technology_categories.find((c) => c.id === catId)
    if (!cat) return
    const cs: CategorySkill = {
      id: newId(), skill_id: skill.id, name: skill.name, proficiency: 0,
      total_duration_in_years: 0, sort_order: cat.skills.length,
    }
    updateItem('technology_categories', catId, { skills: [...cat.skills, cs] })
  }

  const removeSkill = (catId: string, csId: string) => {
    const cat = items.find((x) => x.id === catId)!
    updateItem('technology_categories', catId, { skills: cat.skills.filter((cs) => cs.id !== csId) })
  }

  return (
    <div className="section-pane">
      <p className="registry-note">A curated showcase grouping skills from the registry for display in exports.</p>
      <SortBar section="technology_categories" count={items.length} />
      <SortableList section="technology_categories" ids={items.map((x) => x.id)}>
      {items.map((cat) => (
        <EditorCard key={cat.id} section="technology_categories" id={cat.id}
          title={resolve(cat.name, primaryLocale) || 'Category'} meta={`${cat.skills.length} skills`}
          canStar={false} disabled={cat.disabled}>
          <DualField label="Category name" value={cat.name} onChange={(v) => updateItem('technology_categories', cat.id, { name: v })} />
          <div className="sub-block">
            <div className="sub-head">Skills in this category</div>
            <div className="skill-chip-list">
              {cat.skills.map((cs) => (
                <CategorySkillChip
                  key={cs.id}
                  cs={cs}
                  onRemove={() => removeSkill(cat.id, cs.id)}
                />
              ))}
            </div>
            <Autocomplete
              options={data.skills
                .filter((s) => !cat.skills.some((cs) => cs.skill_id === s.id))
                .map((s) => ({
                  id: s.id,
                  label: resolve(s.name, primaryLocale) || '(unnamed skill)',
                  sublabel: s.skill_type,
                }))}
              onPick={(skillId) => linkSkillIntoCategory(cat.id, skillId)}
              onAddNew={(text) => createSkillAndLink(cat.id, text)}
              addLabel="skill"
              placeholder="Search or add a skill…"
            />
          </div>
        </EditorCard>
      ))}
      </SortableList>
      <AddButton label="Add category" onClick={add} />
      <RegistryStyles />
    </div>
  )
}

/**
 * A clickable chip in a TechnologyCategory's skill list. Click → opens a
 * popover with a DualField bound to the GLOBAL Skill (so editing the
 * translation here updates the registry and propagates to every other
 * reference, by design). The chip's own snapshot is re-synced from the
 * registry name on every render.
 */
function CategorySkillChip({
  cs, onRemove,
}: { cs: CategorySkill; onRemove: () => void }) {
  const { data, primaryLocale, updateItem } = useStore()
  const [open, setOpen] = useState(false)
  const skill = data.skills.find((s) => s.id === cs.skill_id)
  const label = resolve(skill?.name ?? cs.name, primaryLocale) || '(unlinked)'

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
        title="Remove from this category"
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

/**
 * Shared popover surface used by both CategorySkillChip and the
 * ProjectsEditor's project-skill chip. Edits the registry Skill's name
 * (the LocalizedString). Dismisses on outside click.
 */
export function SkillTranslationPopover({
  skill, onClose, onChange,
}: {
  skill: Skill
  onClose: () => void
  onChange: (name: LocalizedString) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    // Defer registration so the click that OPENED the popover doesn't
    // immediately close it.
    const t = setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h) }
  }, [onClose])
  return (
    <div ref={ref} className="stp-pop">
      <div className="stp-head">Edit “{Object.values(skill.name)[0] || 'skill'}” translation</div>
      <DualField label="Skill name" value={skill.name} onChange={onChange} />
      <div className="stp-foot">Changes the registry — all references update.</div>
      <style>{`
        .stp-pop {
          position: absolute; top: calc(100% + 6px); left: 0; z-index: 40;
          width: min(420px, 90vw); padding: 14px 14px 10px;
          background: var(--paper-raised); border: 1px solid var(--line-strong);
          border-radius: var(--r-md); box-shadow: var(--shadow-lg);
        }
        .stp-head {
          font-size: 12px; font-weight: 700; letter-spacing: .04em;
          text-transform: uppercase; color: var(--ink-soft); margin-bottom: 10px;
        }
        .stp-foot { font-size: 11px; color: var(--ink-faint); margin-top: 4px; }
      `}</style>
    </div>
  )
}

function RegistryStyles() {
  return (
    <style>{`
      .registry-note {
        font-size: 13.5px; color: var(--ink-soft); background: var(--paper-sunken);
        padding: 11px 15px; border-radius: var(--r-md); margin-bottom: 16px;
        border-left: 3px solid var(--accent);
      }
      .registry-empty {
        font-size: 13px; color: var(--ink-faint); font-style: italic;
        padding: 24px 16px; text-align: center;
        background: var(--paper-sunken); border-radius: var(--r-md); margin-bottom: 12px;
      }
      /* .check-row lives in src/index.css */
      .sub-block { margin: 16px 0 0; padding: 14px; background: var(--paper-sunken); border-radius: var(--r-md); }
      .sub-head { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 10px; }
      .skill-chip-list { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 10px; }
      .skill-chip-w { position: relative; display: inline-flex; align-items: center; background: var(--paper-raised); border: 1px solid var(--line); border-radius: 20px; padding: 2px 6px 2px 2px; }
      .skill-chip { padding: 4px 10px; font-size: 13px; font-weight: 500; background: transparent; cursor: pointer; }
      .skill-chip:hover { color: var(--accent); }
      .skill-chip-x { width: 20px; height: 20px; display: grid; place-items: center; color: var(--ink-faint); border-radius: 50%; }
      .skill-chip-x:hover { background: var(--accent-wash); color: var(--accent); }
      .usage-block { margin-top: 14px; padding: 12px 14px; background: var(--paper-sunken); border-radius: var(--r-md); }
      .usage-block.usage-empty { color: var(--ink-faint); font-size: 12.5px; }
      .usage-block.usage-empty strong { color: var(--ink-soft); font-weight: 700; margin-right: 4px; }
      .usage-head { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 8px; }
      .usage-sub { font-size: 11px; font-weight: 600; color: var(--ink-faint); text-transform: uppercase; letter-spacing: .04em; margin: 8px 0 4px; }
      .ur-row {
        display: flex; align-items: center; gap: 8px;
        width: 100%; text-align: left; padding: 6px 8px;
        border-radius: var(--r-sm); background: var(--paper-raised);
        border: 1px solid transparent; transition: all .12s;
        font-size: 13px; color: var(--ink); margin-bottom: 4px;
      }
      .ur-row:hover { border-color: var(--accent); color: var(--accent); }
      .ur-icon { color: var(--ink-faint); display: grid; place-items: center; }
      .ur-row:hover .ur-icon { color: var(--accent); }
      .ur-label { flex: 1; }
    `}</style>
  )
}
