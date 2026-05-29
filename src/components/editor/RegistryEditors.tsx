import { useStore, newId } from '../../store/useStore'
import { DualField } from '../ui/DualField'
import { TextField } from '../ui/Fields'
import { EditorCard, AddButton, FieldRow } from '../ui/EditorCard'
import { SortableList } from '../ui/SortableList'
import { resolve } from '../../lib/locales'
import {
  mergeSkills, mergeRoles, countSkillReferences, countRoleReferences,
} from '../../lib/merge'
import type { Skill, Role, Reference, TechnologyCategory, CategorySkill, LocalizedString } from '../../types'
import { X, Plus, Combine } from 'lucide-react'

// ── Skill registry ───────────────────────────────────────────────────────────

export function SkillsEditor() {
  const { data, primaryLocale, addItem, updateItem, replaceData } = useStore()
  const items = [...data.skills].sort((a, b) => resolve(a.name, primaryLocale).localeCompare(resolve(b.name, primaryLocale)))

  // Usage spans projects AND technology categories — countSkillReferences
  // already enumerates every reference site, so reuse it rather than an
  // inline scan that would silently miss the tech-category branch.
  const usage = new Map(items.map((s) => [s.id, countSkillReferences(data, s.id)]))

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
      {items.map((s) => (
        <EditorCard key={s.id} section="skills" id={s.id}
          title={resolve(s.name, primaryLocale)}
          subtitle={s.skill_type}
          meta={`${usage.get(s.id) || 0} ref${(usage.get(s.id) ?? 0) === 1 ? '' : 's'}`}
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
          <MergeRow
            kind="skill"
            sourceId={s.id}
            allItems={items.filter((x) => x.id !== s.id).map((x) => ({ id: x.id, label: resolve(x.name, primaryLocale) }))}
            onMerge={onMerge}
          />
        </EditorCard>
      ))}
      <AddButton label="Add skill" onClick={add} />
      <RegistryStyles />
    </div>
  )
}

// ── Role registry ────────────────────────────────────────────────────────────

export function RolesEditor() {
  const { data, primaryLocale, addItem, updateItem, replaceData } = useStore()
  const items = [...data.roles].sort((a, b) => a.sort_order - b.sort_order)
  const usage = new Map(items.map((r) => [r.id, countRoleReferences(data, r.id)]))

  const add = () => {
    const r: Role = {
      id: newId(), resume_id: data.resume!.id, name: {}, years_of_experience: 0,
      years_of_experience_offset: 0, starred: false, sort_order: items.length, disabled: false,
    }
    addItem('roles', r)
  }

  const onMerge = (sourceId: string, targetId: string) => {
    if (!confirmMerge('role', sourceId, targetId, data.roles, primaryLocale, countRoleReferences(data, sourceId))) return
    replaceData(mergeRoles(data, sourceId, targetId))
  }
  return (
    <div className="section-pane">
      <p className="registry-note">Reusable role labels referenced by projects. "Solution Architect" is defined once here.</p>
      <SortableList section="roles" ids={items.map((x) => x.id)}>
      {items.map((r) => (
        <EditorCard key={r.id} section="roles" id={r.id}
          title={resolve(r.name, primaryLocale)} meta={`${usage.get(r.id) || 0} projects`}
          starred={r.starred} disabled={r.disabled}>
          <DualField label="Role name" value={r.name} onChange={(v) => updateItem('roles', r.id, { name: v })} />
          <FieldRow>
            <TextField label="Years of experience" value={r.years_of_experience.toString()} type="number"
              onChange={(v) => updateItem('roles', r.id, { years_of_experience: parseFloat(v) || 0 })} />
            <TextField label="Manual offset (±)" value={r.years_of_experience_offset.toString()} type="number"
              onChange={(v) => updateItem('roles', r.id, { years_of_experience_offset: parseFloat(v) || 0 })} />
          </FieldRow>
          <MergeRow
            kind="role"
            sourceId={r.id}
            allItems={items.filter((x) => x.id !== r.id).map((x) => ({ id: x.id, label: resolve(x.name, primaryLocale) }))}
            onMerge={onMerge}
          />
        </EditorCard>
      ))}
      </SortableList>
      <AddButton label="Add role" onClick={add} />
      <RegistryStyles />
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

// ── Technology categories (skills showcase) ───────────────────────────────────

export function TechCategoriesEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const items = [...data.technology_categories].sort((a, b) => a.sort_order - b.sort_order)

  const add = () => {
    const c: TechnologyCategory = {
      id: newId(), resume_id: data.resume!.id, name: {}, skills: [], sort_order: items.length, disabled: false,
    }
    addItem('technology_categories', c)
  }
  const addSkill = (catId: string) => {
    const cat = items.find((x) => x.id === catId)!
    const cs: CategorySkill = { id: newId(), skill_id: '', name: {}, proficiency: 0, total_duration_in_years: 0, sort_order: cat.skills.length }
    updateItem('technology_categories', catId, { skills: [...cat.skills, cs] })
  }
  const linkSkill = (catId: string, csId: string, skillId: string) => {
    const cat = items.find((x) => x.id === catId)!
    const reg = data.skills.find((x) => x.id === skillId)
    updateItem('technology_categories', catId, {
      skills: cat.skills.map((cs) => (cs.id === csId ? { ...cs, skill_id: skillId, name: reg ? reg.name : cs.name, total_duration_in_years: reg?.total_duration_in_years || 0 } : cs)),
    })
  }
  const removeSkill = (catId: string, csId: string) => {
    const cat = items.find((x) => x.id === catId)!
    updateItem('technology_categories', catId, { skills: cat.skills.filter((cs) => cs.id !== csId) })
  }

  return (
    <div className="section-pane">
      <p className="registry-note">A curated showcase grouping skills from the registry for display in exports.</p>
      <SortableList section="technology_categories" ids={items.map((x) => x.id)}>
      {items.map((cat) => (
        <EditorCard key={cat.id} section="technology_categories" id={cat.id}
          title={resolve(cat.name, primaryLocale) || 'Category'} meta={`${cat.skills.length} skills`}
          canStar={false} disabled={cat.disabled}>
          <DualField label="Category name" value={cat.name} onChange={(v) => updateItem('technology_categories', cat.id, { name: v })} />
          <div className="sub-block">
            <div className="sub-head">Skills in this category</div>
            <div className="skill-chips">
              {cat.skills.map((cs) => (
                <div key={cs.id} className="skill-chip">
                  <select value={cs.skill_id} onChange={(e) => linkSkill(cat.id, cs.id, e.target.value)} className="skill-chip-sel">
                    <option value="">{resolve(cs.name, primaryLocale) || '— select —'}</option>
                    {data.skills.map((reg) => <option key={reg.id} value={reg.id}>{resolve(reg.name, primaryLocale)}</option>)}
                  </select>
                  <button onClick={() => removeSkill(cat.id, cs.id)}><X size={12} /></button>
                </div>
              ))}
            </div>
            <button className="sub-add" onClick={() => addSkill(cat.id)}><Plus size={13} /> Add skill</button>
          </div>
        </EditorCard>
      ))}
      </SortableList>
      <AddButton label="Add category" onClick={add} />
      <RegistryStyles />
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
      /* .check-row lives in src/index.css */
      .sub-block { margin: 16px 0 0; padding: 14px; background: var(--paper-sunken); border-radius: var(--r-md); }
      .sub-head { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 10px; }
      .skill-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 10px; }
      .skill-chip { display: inline-flex; align-items: center; background: var(--paper-raised); border: 1px solid var(--line); border-radius: 20px; padding: 2px 4px 2px 2px; }
      .skill-chip-sel { border: none; background: none; padding: 4px 6px; font-size: 13px; font-weight: 500; max-width: 200px; }
      .skill-chip button { width: 20px; height: 20px; display: grid; place-items: center; color: var(--ink-faint); border-radius: 50%; }
      .skill-chip button:hover { background: var(--accent-wash); color: var(--accent); }
      .sub-add { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; font-size: 13px; font-weight: 600; color: var(--accent); border-radius: var(--r-sm); }
      .sub-add:hover { background: var(--accent-wash); }
    `}</style>
  )
}
