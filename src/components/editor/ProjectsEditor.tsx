import { useState, type ReactNode } from 'react'
import { useStore, newId } from '../../store/useStore'
import { useSortedItems } from '../../store/useSortedItems'
import { suggestSkillNames } from '../../lib/skillTaxonomy'
import { DualField } from '../ui/DualField'
import { RichField } from '../ui/RichField'
import { TextField, DateField } from '../ui/Fields'
import { EditorCard, FieldRow } from '../ui/EditorCard'
import { SortableList } from '../ui/SortableList'
import { SortBar } from '../ui/SortBar'
import { SectionIntro } from '../ui/SectionIntro'
import { Autocomplete } from '../ui/Autocomplete'
import { SkillTranslationPopover } from './RegistryEditors'
import { TranslationPopover } from '../ui/TranslationPopover'
import { effectiveSkillCategory, categoryNameIndex } from '../../lib/skillCategorize'
import { AssistRun } from '../ui/AssistRun'
import { useAdvisorRun } from '../../store/useAdvisorRun'
import { fieldScope } from '../../store/useAdvisors'
import { KeyPointsPanel } from '../ui/KeyPointsPanel'
import { WritingAssist } from '../ui/WritingAssist'
import { toHighlights } from '../../lib/keyPoints'
import { extractJson } from '../../lib/llmAssist'
import {
  buildSkillExtractPrompt, validateSkillExtract, resolveSuggestions, registryVocabulary,
  type ExtractionResult, type SkillSuggestion,
} from '../../lib/skillExtract'
import { resolve, fmtRange } from '../../lib/locales'
import { richToPlain } from '../../lib/richText'
import { DebriefModal } from './DebriefModal'
import type { Project, ProjectRole, ProjectIndustry, ProjectSkill, Skill, Industry, Role, LocalizedString } from '../../types'
import { Plus, X, MessageSquareText } from 'lucide-react'

export function ProjectsEditor() {
  const { data, primaryLocale, addItem, updateItem } = useStore()
  const projects = useSortedItems('projects')

  // The open debrief is tracked by ID, not object, so the modal re-reads the
  // live project as answers/applies mutate it.
  const [debriefId, setDebriefId] = useState<string | null>(null)
  const debriefProject = debriefId ? projects.find((p) => p.id === debriefId) ?? null : null

  const addProject = () => {
    const p: Project = {
      id: newId(), resume_id: data.resume!.id, work_experience_id: null,
      customer: {}, customer_anonymized: {}, use_anonymized: false, industries: [],
      description: {}, long_description: {}, highlights: [], roles: [], skills: [],
      start: null, end: null, percent_allocated: null, team_size: null,
      location_country_code: null, external_url: null,
      sort_order: projects.length, starred: false, disabled: false, internal_notes: null,
    }
    addItem('projects', p)
  }

  return (
    <div className="section-pane">
      <SectionIntro>
        Client engagements and deliverables. Link each to an employer, roles,
        skills and industries; star the strongest to feature them as Promoted
        Projects in a view.
      </SectionIntro>
      <SortBar section="projects" />
      <SortableList section="projects" ids={projects.map((p) => p.id)} addLabel="Add project" onAdd={addProject}>
      {projects.map((p) => (
        <EditorCard key={p.id} section="projects" id={p.id}
          title={resolve(p.customer, primaryLocale) || resolve(p.description, primaryLocale)}
          subtitle={[
            resolve(p.description, primaryLocale),
            p.roles.filter((r) => !r.disabled).map((r) => resolve(r.name, primaryLocale)).filter(Boolean).join(', '),
          ].filter(Boolean).join(' · ')}
          meta={fmtRange(p.start, p.end)}
          preview={richToPlain(resolve(p.long_description, primaryLocale))}
          starred={p.starred} disabled={p.disabled}>

          {/* A project has more moving parts than any other section, so it is
              the one that gets grouped into the sunken blocks the registries
              already use. Everything that identifies the engagement — who,
              what, when, how much of you — is one block. Dates and allocation
              sit ABOVE the descriptions: four small number fields disappear
              when they're stranded between two walls of prose. */}
          <div className="sub-block">
            <div className="sub-head">The engagement</div>
            <DualField label="Customer" value={p.customer} onChange={(v) => updateItem('projects', p.id, { customer: v })} />
            <DualField label="Project name" value={p.description} onChange={(v) => updateItem('projects', p.id, { description: v })} />
            <FieldRow>
              <DateField label="Start" value={p.start} onChange={(v) => updateItem('projects', p.id, { start: v })} />
              <DateField label="End" value={p.end} onChange={(v) => updateItem('projects', p.id, { end: v })} allowOngoing />
              <TextField label="Allocation %" value={p.percent_allocated?.toString() || ''} type="number"
                onChange={(v) => updateItem('projects', p.id, { percent_allocated: v ? parseInt(v) : null })} />
              <TextField label="Team size" value={p.team_size?.toString() || ''} type="number"
                onChange={(v) => updateItem('projects', p.id, { team_size: v ? parseInt(v) : null })} />
            </FieldRow>
          </div>

          <ProjectIndustriesEditor project={p} />
          <ProjectRolesEditor project={p} />

          <div className="sub-block">
            <div className="sub-head">Description</div>
            <RichField label="Description" value={p.long_description} onChange={(v) => updateItem('projects', p.id, { long_description: v })} />
            {/* Writes the PRIMARY column only — the model read one locale, so
                filling the other would be a translation nobody asked for. */}
            <WritingAssist
              section="projects" item={p} source={p.long_description} locale={primaryLocale}
              onApply={(html) => updateItem('projects', p.id, {
                long_description: { ...p.long_description, [primaryLocale]: html },
              })}
            />
          </div>

          <div className="sub-block">
            <div className="sub-head">Short description <span className="sub-hint">shown in summary mode</span></div>
            <DualField label="Short description" value={p.short_description ?? {}} onChange={(v) => updateItem('projects', p.id, { short_description: v })} summarizeFrom={p.long_description} summarizeItem={{ section: 'projects', item: p }} placeholder="One concise line shown in summary mode" />
          </div>

          <HighlightsEditor project={p} />
          <ProjectSkillsEditor project={p} />

          <div className="sub-block">
            <div className="sub-head">Reference</div>
            <TextField label="External case-study URL" value={p.external_url || ''} onChange={(v) => updateItem('projects', p.id, { external_url: v })} />
            <TextField label="Country code" value={p.location_country_code || ''} onChange={(v) => updateItem('projects', p.id, { location_country_code: v })} placeholder="e.g. NO — exported as the country name" />
          </div>

          {/* The debrief interview — most valuable right after the engagement
              ends (the Overview nudges then), but available any time. */}
          <button className="pj-debrief" onClick={() => setDebriefId(p.id)}>
            <MessageSquareText size={14} /> Debrief this project
          </button>
        </EditorCard>
      ))}
      </SortableList>
      {debriefProject && (
        <DebriefModal project={debriefProject} onClose={() => setDebriefId(null)} />
      )}
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
      {/* The suggest button sits BESIDE Add highlight: both add rows to the
          same list, so they belong on one line rather than a stack. Reshapes
          the project's own long description into bullets — drafts land in the
          primary locale; the secondary column is the user's existing
          Copy/Draft-translation job. */}
      <div className="sub-add-row">
        <button className="sub-add" onClick={add}><Plus size={13} /> Add highlight</button>
        <KeyPointsPanel
          section="projects"
          itemId={project.id}
          source={project.long_description}
          locale={primaryLocale}
          style="highlights"
          noun="highlights"
          inline
          onApply={(points) => updateItem('projects', project.id, {
            highlights: [...project.highlights, ...toHighlights(points, primaryLocale)],
          })}
        />
      </div>
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
 * A registry-link chip on a project: the linked entry's name, a × to unlink,
 * and a click-to-open translation popover.
 *
 * The skill, role and industry chips were three copies of this — same markup,
 * same open/remove behaviour, differing only in which popover they open. That
 * difference stays with the caller, as `renderPopover`.
 */
function RegistryLinkChip({ label, onRemove, renderPopover }: {
  label: string
  onRemove: () => void
  /** The popover shown while the chip is open, or null for an unlinked chip. */
  renderPopover: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="skill-chip-w">
      <button type="button" className="skill-chip" onClick={() => setOpen((o) => !o)} title="Edit translation">
        <span>{label}</span>
      </button>
      <button type="button" className="skill-chip-x" onClick={(e) => { e.stopPropagation(); onRemove() }} title="Remove from this project">
        <X size={12} />
      </button>
      {open && renderPopover(() => setOpen(false))}
    </div>
  )
}

/**
 * A ProjectIndustry chip. The popover edits the registry Industry name so the
 * change propagates to every reference; for a stale link with no registry
 * entry it edits the project's local snapshot instead.
 */
function ProjectIndustryChip({ project, pi, onRemove }: { project: Project; pi: ProjectIndustry; onRemove: () => void }) {
  const { data, primaryLocale, updateItem } = useStore()
  const industry = data.industries.find((i) => i.id === pi.industry_id)
  const label = resolve(industry?.name ?? pi.name, primaryLocale) || '(unnamed industry)'

  const onChangeName = (name: LocalizedString) => {
    if (industry) updateItem('industries', industry.id, { name })
    else updateItem('projects', project.id, { industries: project.industries.map((x) => (x.id === pi.id ? { ...x, name } : x)) })
  }

  return (
    <RegistryLinkChip label={label} onRemove={onRemove} renderPopover={(close) => (
      <TranslationPopover
        title={`Edit “${label}” translation`}
        fieldLabel="Industry name"
        value={industry?.name ?? pi.name}
        footnote={industry ? 'Changes the registry — all references update.' : 'Not linked to the registry.'}
        onClose={close}
        onChange={onChangeName}
      />
    )} />
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
    // `open: false` — the default would expand the new role's card and collapse
    // the project card the user is still working in.
    addItem('roles', reg, { open: false })
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
 * A ProjectRole chip. When linked to a registry Role the popover edits the
 * registry name (propagating everywhere); a legacy free-text role with no
 * registry link edits the project's local snapshot instead.
 */
function ProjectRoleChip({ project, pr, onRemove }: { project: Project; pr: ProjectRole; onRemove: () => void }) {
  const { data, primaryLocale, updateItem } = useStore()
  const role = pr.role_id ? data.roles.find((x) => x.id === pr.role_id) : null
  const label = resolve(role?.name ?? pr.name, primaryLocale) || '(unnamed role)'

  const onChangeName = (name: LocalizedString) => {
    if (role) updateItem('roles', role.id, { name })
    else updateItem('projects', project.id, { roles: project.roles.map((r) => (r.id === pr.id ? { ...r, name } : r)) })
  }

  return (
    <RegistryLinkChip label={label} onRemove={onRemove} renderPopover={(close) => (
      <TranslationPopover
        title={`Edit “${label}” translation`}
        fieldLabel="Role name"
        value={role?.name ?? pr.name}
        footnote={role ? 'Changes the registry — all references update.' : 'Free-text role — not linked to the registry.'}
        onClose={close}
        onChange={onChangeName}
      />
    )} />
  )
}

// ── Project skills ───────────────────────────────────────────────────────────

function ProjectSkillsEditor({ project }: { project: Project }) {
  const { data, addItem, updateItem, primaryLocale } = useStore()
  const catNamesById = categoryNameIndex(data.skill_categories ?? [], primaryLocale)

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
      category_id: null,
      total_duration_in_years: 0, proficiency: 0,
      is_highlighted: false, created_at: new Date().toISOString(),
    }
    // `open: false` for the same reason as the role case above.
    addItem('skills', reg, { open: false })
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
      {/* Search and suggest sit on one line: both put skills into the same
          list, and the suggestion is the shortcut for "I can't remember what
          I used". */}
      <div className="sub-add-row">
        <div className="sub-add-grow">
          <Autocomplete
            options={data.skills
              .filter((reg) => !project.skills.some((ps) => ps.skill_id === reg.id))
              .map((reg) => ({
                id: reg.id,
                label: resolve(reg.name, primaryLocale) || '(unnamed skill)',
                sublabel: reg.category_id ? effectiveSkillCategory(reg, catNamesById) : undefined,
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
        <SkillSuggestPanel project={project} onLink={linkExisting} onCreate={createAndLink} inline />
      </div>

    </div>
  )
}

/**
 * "Suggest skills from the description" — reads the project's prose and offers
 * the skills it evidences, resolved against the registry (lib/skillExtract.ts).
 *
 * Nothing is written until the user confirms, and the two groups are ticked
 * differently on purpose: linking an EXISTING registry skill is cheap and
 * reversible, so it's pre-ticked; creating a NEW registry entry grows a shared
 * resource every other project sees, so it isn't.
 */
function SkillSuggestPanel({ project, onLink, onCreate, inline = false }: {
  project: Project
  onLink: (skillId: string) => void
  onCreate: (name: string) => void
  /** Beside the skill search field rather than stacked above it. */
  inline?: boolean
}) {
  const { data, primaryLocale } = useStore()
  // The run outlives this panel: the card it sits in unmounts the moment you
  // click another project (CLAUDE.md §15 — the same reason the Overview
  // advisors moved here first). The parse re-resolves against the LIVE
  // registry, so a skill linked by hand meanwhile re-reads as already linked.
  const {
    ref, result, parseError, run, resolve: resolveRow, clear,
  } = useAdvisorRun<ExtractionResult>(
    'skills',
    (raw) => resolveSuggestions(
      validateSkillExtract(JSON.parse(extractJson(raw))).skills,
      project, data.skills, primaryLocale,
    ),
    fieldScope('projects', project.id),
    `${data.skills.length}:${project.skills.length}`,
  )

  const hasProse = !!resolve(project.long_description, primaryLocale).trim()
    || !!resolve(project.description, primaryLocale).trim()

  // Existing registry hits start ticked; novel ones don't — growing the shared
  // registry deserves a deliberate click. The user's own ticks override that
  // default and ride with the run, so navigating away doesn't reset them.
  const isPicked = (s: SkillSuggestion, isNew: boolean) => {
    const mark = run?.resolved[s.label]
    return mark ? mark === 'accepted' : !isNew
  }
  const pickedCount = result
    ? result.existing.filter((s) => isPicked(s, false)).length
      + result.novel.filter((s) => isPicked(s, true)).length
    : 0

  const apply = () => {
    if (!result) return
    for (const s of result.existing) if (isPicked(s, false) && s.skillId) onLink(s.skillId)
    for (const s of result.novel) if (isPicked(s, true)) onCreate(s.label)
    clear()
  }

  const row = (s: SkillSuggestion, isNew: boolean) => (
    <label key={s.label} className="ss-row">
      <input
        type="checkbox"
        checked={isPicked(s, isNew)}
        onChange={() => resolveRow(s.label, isPicked(s, isNew) ? 'dismissed' : 'accepted')}
      />
      <span className="ss-name">{s.label}</span>
      <span className={`ss-tag ${isNew ? 'ss-new' : ''}`}>{isNew ? 'new registry skill' : 'in registry'}</span>
    </label>
  )

  return (
    <div className={inline ? 'ss-wrap ss-inline' : 'ss-wrap'}>
      <AssistRun
        buildPrompt={() => buildSkillExtractPrompt(project, primaryLocale, registryVocabulary(data.skills, primaryLocale))}
        advisor={ref}
        compact={inline}
        disabled={!hasProse}
        label={inline ? 'Suggest skills' : 'Suggest skills from the description'}
        maxTokens={400}
        hasManualPath={false}
      />
      {!hasProse && !run && <p className="ss-hint">Add a description first — there's nothing to read yet.</p>}
      {parseError && <p className="ss-hint ss-err" role="alert">{parseError}</p>}

      {result && (
        <div className="ss-result">
          {result.existing.length === 0 && result.novel.length === 0 && (
            <p className="ss-hint">Nothing new found — every skill it spotted is already linked.</p>
          )}
          {result.existing.map((s) => row(s, false))}
          {result.novel.map((s) => row(s, true))}
          {result.alreadyLinked.length > 0 && (
            <p className="ss-hint">Already linked: {result.alreadyLinked.map((s) => s.label).join(', ')}</p>
          )}
          {(result.existing.length > 0 || result.novel.length > 0) && (
            <div className="ss-actions">
              <button className="ss-btn" onClick={clear}>Discard</button>
              <button className="ss-btn ss-primary" onClick={apply} disabled={pickedCount === 0}>
                Add {pickedCount} skill{pickedCount === 1 ? '' : 's'}
              </button>
            </div>
          )}
        </div>
      )}

      <style>{`
        .ss-wrap { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; }
        .ss-hint { font-size: 12px; color: var(--ink-faint); margin: 0; }
        .ss-err { color: var(--err-ink); }
        .ss-result {
          display: flex; flex-direction: column; gap: 4px;
          padding: 10px; border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper-sunken);
        }
        .ss-row { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; padding: 2px 0; }
        .ss-row input { accent-color: var(--accent); width: 14px; height: 14px; }
        .ss-name { flex: 1; }
        .ss-tag { font-size: 11px; color: var(--ink-faint); text-transform: uppercase; letter-spacing: .04em; }
        .ss-new { color: var(--warn-ink); }
        .ss-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
        .ss-btn {
          padding: 5px 11px; font-size: 12.5px; border: 1px solid var(--line-strong);
          border-radius: var(--r-sm); background: var(--paper-raised); cursor: pointer;
        }
        .ss-primary { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 600; }
        .ss-primary:disabled { opacity: .5; cursor: default; }
      `}</style>
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
  const skill = data.skills.find((x) => x.id === ps.skill_id)
  const label = resolve(skill?.name ?? ps.name, primaryLocale) || '(unlinked)'

  return (
    <RegistryLinkChip label={label} onRemove={onRemove} renderPopover={(close) => (
      // A dangling link (registry entry deleted) has nothing to edit.
      skill ? (
        <SkillTranslationPopover
          skill={skill}
          onClose={close}
          onChange={(name) => updateItem('skills', skill.id, { name })}
        />
      ) : null
    )} />
  )
}

function PaneStyles() {
  return (
    <style>{`
      /* .section-pane, .editor-block, .sub-block/.sub-head/.sub-hint and the
         .skill-chip-* family are shared across editors and live in
         src/index.css — see the note there. Only this pane's own classes
         belong below. */
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
      .pj-debrief {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 7px 13px; font-size: 12.5px; font-weight: 600;
        color: var(--accent); border: 1px solid var(--accent); border-radius: var(--r-sm);
        background: var(--paper); transition: background .12s, color .12s;
      }
      .pj-debrief:hover { background: var(--accent-wash); }
    `}</style>
  )
}
