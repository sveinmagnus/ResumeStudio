import { useState, useMemo, useRef, useEffect, useId, type ReactNode } from 'react'
import { useStore, newId } from '../../store/useStore'
import { useSortedItems } from '../../store/useSortedItems'
import { useStableExpanded } from '../../store/useStableExpanded'
import {
  suggestSkillNames, loadSkillRelations, relatedSkillSuggestions, loadSkillDomains,
  loadSkillDomainModel, type SkillRelations, type SkillDomains, type SkillDomainModel,
} from '../../lib/skillTaxonomy'
import {
  autoCategorizeSkills, clearSkillCategories, effectiveSkillCategory, UNCATEGORIZED_LABEL,
} from '../../lib/skillCategorize'
import { INFERRED_TIERS } from '../../lib/skillMatch'
import { DualField } from '../ui/DualField'
import { TextField } from '../ui/Fields'
import { EditorCard, AddButton, FieldRow } from '../ui/EditorCard'
import { SortableList } from '../ui/SortableList'
import { SortBar } from '../ui/SortBar'
import { Autocomplete } from '../ui/Autocomplete'
import { confirmDialog } from '../ui/ConfirmDialog'
import { RegistryCategoryView, RegistryLightbox, categoriesOf } from './RegistryCategoryView'
import { resolve, fmtRange } from '../../lib/locales'
import {
  mergeSkills, mergeRoles, mergeIndustries,
  countSkillReferences, countRoleReferences, countIndustryReferences,
} from '../../lib/merge'
import { usageOfSkill, usageOfRole, usageOfIndustry, isSkillUnused, isRoleUnused } from '../../lib/usage'
import type {
  Skill, Role, Industry, Reference, TechnologyCategory, CategorySkill,
  LocalizedString, Project, WorkExperience,
} from '../../types'
import { X, Plus, Sparkles, Combine, Filter as FilterIcon, Briefcase, FolderKanban, List, LayoutGrid, Wand2, Check } from 'lucide-react'

// ── Shared registry-filter bar ──────────────────────────────────────────────

type RegistryFilter = 'all' | 'unused' | 'missing-translation'

function FilterBar({
  filter, onChange, counts, extra,
}: {
  filter: RegistryFilter
  onChange: (f: RegistryFilter) => void
  counts: { all: number; unused: number; missing: number }
  /** Optional right-aligned controls (e.g. the Skills category selector). */
  extra?: ReactNode
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
      {extra && <div className="fb-extra">{extra}</div>}
      <style>{`
        .fb-wrap {
          display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 14px;
          padding: 8px 10px; background: var(--paper-sunken); border-radius: var(--r-md);
        }
        .fb-extra { margin-left: auto; display: flex; align-items: center; gap: 6px; }
        .fb-icon { color: var(--ink-faint); margin-right: 2px; }
        .fb-btn {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 10px; font-size: 12.5px; font-weight: 600;
          color: var(--ink-soft); background: transparent;
          border: 1px solid transparent; border-radius: var(--r-sm);
          transition: color .12s, background .12s, border-color .12s, box-shadow .12s; cursor: pointer;
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

interface NamedItem { id: string; name: LocalizedString }

/**
 * Freeze the list of rows shown in the batch "Missing translation" view. Once
 * you fill a row it's no longer "missing", but yanking it out mid-keystroke
 * would be jarring — so while the filter is active we keep the rows captured on
 * entry (resolved to live data, so the text updates and a ✓ appears). Switching
 * filters re-snapshots. Ref-during-render is intentional and idempotent.
 */
function useFrozenMissing<T extends NamedItem>(active: boolean, missing: T[], allItems: T[]): T[] {
  const frozen = useRef<string[] | null>(null)
  if (active) { if (!frozen.current) frozen.current = missing.map((i) => i.id) }
  else if (frozen.current) frozen.current = null
  const byId = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems])
  if (!active || !frozen.current) return missing
  const out: T[] = []
  for (const id of frozen.current) { const it = byId.get(id); if (it) out.push(it) }
  return out
}

/**
 * Batch translation surface for the "Missing translation" filter: a compact
 * list of DualFields (name only — the one translatable registry field) so the
 * consultant can type/Copy translations for many entries without opening each
 * card. `missing` should come from useFrozenMissing so rows don't vanish on the
 * first keystroke; a **Show all** toggle swaps to `all` for reviewing/correcting
 * every translation. Any row can expand to the **full editor** in place
 * (`renderEditor`) — the quick DualField is replaced by the full body (which
 * still carries the name field), so nothing is lost.
 */
function MissingTranslationList({ label, missing, all, onSet, renderEditor }: {
  label: string
  missing: NamedItem[]
  all: NamedItem[]
  onSet: (id: string, name: LocalizedString) => void
  renderEditor: (id: string) => ReactNode
}) {
  const primary = useStore((s) => s.primaryLocale)
  const secondary = useStore((s) => s.secondaryLocale)
  const [showAll, setShowAll] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const items = showAll ? all : missing

  return (
    <div className="mtl">
      <div className="mtl-toolbar">
        <label className="check-row mtl-toggle">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show all ({all.length})
        </label>
        <span className="mtl-note">
          {showAll
            ? `${missing.length} still missing a translation`
            : 'Type or Copy each secondary-language name. Completed rows stay (✓) until you switch filters.'}
        </span>
      </div>
      {items.length === 0 && (
        <div className="registry-empty">
          {showAll ? 'Nothing to show yet.' : 'No entries are missing a translation — toggle "Show all" to review everything.'}
        </div>
      )}
      {items.map((it) => {
        const done = !isMissingTranslation(it.name, primary, secondary)
        const open = openId === it.id
        return (
          <div key={it.id} className={`mtl-row ${done ? 'is-done' : ''} ${open ? 'is-open' : ''}`}>
            <div className="mtl-row-actions">
              {done && !open && <span className="mtl-done" role="status"><Check size={13} /> done</span>}
              <button type="button" className="mtl-open"
                onClick={() => setOpenId(open ? null : it.id)}
                aria-expanded={open}>
                {open ? 'Close editor' : 'Open full editor'}
              </button>
            </div>
            {open
              ? <div className="mtl-full">{renderEditor(it.id)}</div>
              : <DualField label={label} value={it.name} onChange={(v) => onSet(it.id, v)} />}
          </div>
        )
      })}
      <style>{`
        .mtl { margin-top: 4px; }
        .mtl-toolbar {
          display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; margin-bottom: 12px;
        }
        .mtl-toggle { font-weight: 600; }
        .mtl-note { font-size: 12px; color: var(--ink-faint); }
        .mtl-row {
          position: relative; padding: 12px 14px 12px; margin-bottom: 8px;
          background: var(--paper-raised); border: 1px solid var(--line); border-radius: var(--r-md);
        }
        .mtl-row .df-wrap { margin-bottom: 0; }
        .mtl-row.is-done { border-color: var(--ok-ink); background: var(--ok-wash); }
        .mtl-row.is-open { background: var(--paper-sunken); }
        .mtl-row-actions {
          position: absolute; top: 10px; right: 12px; z-index: 1;
          display: flex; align-items: center; gap: 10px;
        }
        .mtl-done { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 700; color: var(--ok-ink); }
        .mtl-open {
          font-size: 11.5px; font-weight: 600; color: var(--accent);
          padding: 3px 9px; border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper); transition: color .12s, border-color .12s, background .12s;
        }
        .mtl-open:hover { border-color: var(--accent); background: var(--accent-wash); }
        /* Give the quick DualField room so its locale tags clear the actions. */
        .mtl-row:not(.is-open) .df-label { padding-right: 120px; }
      `}</style>
    </div>
  )
}

// ── Skill registry ───────────────────────────────────────────────────────────

/**
 * Suggested related skills (roadmap F12 pt3): from the Quadim relatesTo graph,
 * surface library skills related to what the user already has but hasn't added
 * yet. Lazy-loads the relations chunk; renders nothing until there are
 * suggestions. Per-session dismissal keeps the row from nagging.
 */
function RelatedSkillsPanel({ onAdd }: { onAdd: (name: string) => void }) {
  const skills = useStore((s) => s.data.skills)
  const primaryLocale = useStore((s) => s.primaryLocale)
  const [relations, setRelations] = useState<SkillRelations | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    let alive = true
    void loadSkillRelations().then((r) => { if (alive) setRelations(r) }).catch(() => { /* feature just hides */ })
    return () => { alive = false }
  }, [])

  const have = useMemo(
    () => skills.map((s) => resolve(s.name, primaryLocale)).filter(Boolean),
    [skills, primaryLocale],
  )
  const suggestions = useMemo(() => {
    if (!relations) return []
    return relatedSkillSuggestions(have, relations).filter((s) => !dismissed.has(s.name.toLowerCase()))
  }, [relations, have, dismissed])

  if (suggestions.length === 0) return null
  const dismiss = (name: string) =>
    setDismissed((d) => new Set(d).add(name.toLowerCase()))

  return (
    <div className="rsp" role="group" aria-label="Suggested related skills">
      <span className="rsp-label"><Sparkles size={13} /> Related skills you might add</span>
      <div className="rsp-chips">
        {suggestions.map((s) => (
          <span key={s.name} className="rsp-chip">
            <button type="button" className="rsp-add" onClick={() => onAdd(s.name)}
              title={`Add "${s.name}" to your skill registry`}>
              <Plus size={11} /> {s.name}
            </button>
            <button type="button" className="rsp-x" onClick={() => dismiss(s.name)}
              aria-label={`Dismiss ${s.name}`} title="Not relevant">
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * Auto-categorize the skill registry from the Quadim library (fully offline).
 * Lazy-loads the domain map, the relations graph and the semantic token model,
 * previews how many uncategorized skills the layered matcher (exact → token →
 * fuzzy → semantic → graph) would place, and applies via replaceData so the
 * change is undoable + auto-saved. Only fills blanks — a category set by hand is
 * never overwritten. Renders null when nothing applies.
 */
function AutoCategorizePanel() {
  const data = useStore((s) => s.data)
  const replaceData = useStore((s) => s.replaceData)
  const [domains, setDomains] = useState<SkillDomains | null>(null)
  const [relations, setRelations] = useState<SkillRelations | null>(null)
  const [model, setModel] = useState<SkillDomainModel | null>(null)
  const [justRan, setJustRan] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    void loadSkillDomains().then((d) => { if (alive) setDomains(d) }).catch(() => { /* feature just hides */ })
    void loadSkillRelations().then((r) => { if (alive) setRelations(r) }).catch(() => { /* graph tier skips */ })
    void loadSkillDomainModel().then((m) => { if (alive) setModel(m) }).catch(() => { /* semantic tier skips */ })
    return () => { alive = false }
  }, [])

  // Preview only — nothing is applied until the user clicks. Wait for the model
  // too so the first preview already reflects the semantic tier.
  const preview = useMemo(() => {
    if (!domains || !model) return null
    return autoCategorizeSkills(data, domains, { relations: relations ?? undefined, model })
  }, [data, domains, relations, model])

  const pending = preview?.changed ?? 0
  if (pending === 0 && justRan === null) return null

  const apply = () => {
    if (!preview || preview.changed === 0) return
    replaceData(preview.store)
    setJustRan(preview.changed)
  }

  // fuzzy/semantic/graph matches are best-effort — surface them as "review".
  const inferred = preview?.assignments.filter((a) => INFERRED_TIERS.has(a.tier)).length ?? 0

  return (
    <div className="acp" role="group" aria-label="Auto-categorize skills">
      {pending > 0 ? (
        <>
          <span className="acp-text">
            <Wand2 size={13} /> {pending} skill{pending === 1 ? '' : 's'} can be categorized
            from the skill library{inferred > 0 ? ` (${inferred} inferred — worth a review)` : ''}.
          </span>
          <button type="button" className="acp-btn" onClick={apply}>
            Auto-categorize {pending}
          </button>
        </>
      ) : (
        <span className="acp-text acp-done" role="status">
          <Wand2 size={13} /> Categorized {justRan} skill{justRan === 1 ? '' : 's'} — undo with Ctrl+Z.
        </span>
      )}
    </div>
  )
}

/**
 * The Skill/Role registry **category** control: a styled autocomplete bound to
 * the free-text category value. Unlike a native `<datalist>` it (a) stores the
 * raw text so spaces work while typing (trims only on blur), (b) renders a real
 * custom dropdown of existing categories, and (c) shows a distinct "New
 * category" row so it's obvious when you're creating one vs. picking an existing.
 */
function CategoryField({ value, categories, onChange, ariaLabel }: {
  value: string | null
  categories: string[]
  onChange: (v: string | null) => void
  ariaLabel?: string
}) {
  // Local input state so spaces type freely; the store is updated only on
  // commit (pick / Enter / blur), which also keeps the suggestion list from
  // matching the in-progress text against the item's own (uncommitted) value.
  const [input, setInput] = useState(value ?? '')
  const [open, setOpen] = useState(false)
  const [hl, setHl] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)
  const focused = useRef(false)
  const listId = useId()

  // Re-seed from the external value when it changes and we're not editing
  // (e.g. the lightbox switches to a different item).
  useEffect(() => { if (!focused.current) setInput(value ?? '') }, [value])

  const q = input.trim().toLowerCase()
  const matches = useMemo(() => {
    return categories
      .map((c) => {
        const lc = c.toLowerCase()
        if (!q) return { c, s: 1 }
        if (lc === q) return { c, s: 0 }
        if (lc.startsWith(q)) return { c, s: 1 }
        if (lc.includes(q)) return { c, s: 2 }
        return { c, s: -1 }
      })
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.c.localeCompare(b.c))
      .map((x) => x.c)
      .slice(0, 8)
  }, [categories, q])

  const exact = q.length > 0 && categories.some((c) => c.trim().toLowerCase() === q)
  const showAdd = q.length > 0 && !exact
  const rowCount = matches.length + (showAdd ? 1 : 0)

  const commit = (v: string) => {
    setInput(v)
    onChange(v.trim() || null)
    setOpen(false)
    setHl(-1)
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHl((h) => Math.min(rowCount - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(-1, h - 1)) }
    else if (e.key === 'Enter' && open && hl >= 0) {
      e.preventDefault()
      if (hl < matches.length) commit(matches[hl])
      else if (showAdd) commit(input)
    } else if (e.key === 'Escape') { setOpen(false); setHl(-1) }
  }

  return (
    <div className="cf-wrap" ref={wrapRef}>
      <input
        type="text"
        className="pf-input"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open && rowCount > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        value={input}
        placeholder="Uncategorized"
        onChange={(e) => { setInput(e.target.value); setOpen(true); setHl(-1) }}
        onFocus={() => { focused.current = true; setOpen(true) }}
        // Commit (and trim) on blur. Option clicks preventDefault, so blur won't
        // fire before them; a genuine blur (Tab/click-away) commits the text.
        onBlur={() => { focused.current = false; commit(input) }}
        onKeyDown={onKey}
      />
      {open && rowCount > 0 && (
        <div className="cf-pop" role="listbox" id={listId}>
          {matches.map((c, i) => (
            <button key={c} type="button" role="option" aria-selected={i === hl}
              className={`cf-row ${i === hl ? 'is-hl' : ''}`}
              onMouseEnter={() => setHl(i)}
              onMouseDown={(e) => { e.preventDefault(); commit(c) }}>
              {c}
            </button>
          ))}
          {showAdd && (
            <button type="button" role="option" aria-selected={hl === matches.length}
              className={`cf-row cf-row-add ${hl === matches.length ? 'is-hl' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); commit(input) }}>
              <Plus size={12} /> <span>New category <em>“{input.trim()}”</em></span>
            </button>
          )}
        </div>
      )}
      <style>{`
        .cf-wrap { position: relative; display: block; }
        .cf-pop {
          position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 30;
          background: var(--paper-raised); border: 1px solid var(--line-strong);
          border-radius: var(--r-sm); box-shadow: var(--shadow-md);
          max-height: 240px; overflow-y: auto; padding: 4px;
        }
        .cf-row {
          display: flex; align-items: center; gap: 6px; width: 100%; text-align: left;
          padding: 6px 10px; border-radius: var(--r-sm); font-size: 13px; color: var(--ink);
          background: transparent; transition: background .08s; cursor: pointer;
        }
        .cf-row.is-hl, .cf-row:hover { background: var(--accent-wash); }
        .cf-row-add {
          border-top: 1px solid var(--line); margin-top: 2px; padding-top: 8px;
          color: var(--accent); font-weight: 600; font-size: 12.5px;
        }
        .cf-row-add em { font-style: normal; font-weight: 500; }
      `}</style>
    </div>
  )
}

/**
 * A skill's edit fields — shared by the list-view card and the category-view
 * lightbox so both surfaces show the same editor.
 */
function SkillEditBody({ skill, allSkills, categories, onMerge }: {
  skill: Skill
  allSkills: Skill[]
  categories: string[]
  onMerge: (sourceId: string, targetId: string) => void
}) {
  const { data, primaryLocale, updateItem } = useStore()
  const u = usageOfSkill(data, skill.id)
  return (
    <>
      <DualField label="Skill name" value={skill.name} onChange={(v) => updateItem('skills', skill.id, { name: v })} />
      <FieldRow>
        <div className="pf-wrap">
          <span className="pf-label">Category</span>
          <CategoryField
            value={skill.category ?? null}
            categories={categories}
            ariaLabel="Category"
            onChange={(v) => updateItem('skills', skill.id, { category: v })}
          />
        </div>
        <label className="pf-wrap">
          <span className="pf-label">Proficiency (0–5)</span>
          <input className="pf-input" type="number" min={0} max={5} value={skill.proficiency}
            onChange={(e) => updateItem('skills', skill.id, { proficiency: parseInt(e.target.value) || 0 })} />
        </label>
        <TextField label="Total years" value={skill.total_duration_in_years.toFixed(1)}
          onChange={(v) => updateItem('skills', skill.id, { total_duration_in_years: parseFloat(v) || 0 })} />
      </FieldRow>
      <label className="check-row">
        <input type="checkbox" checked={skill.is_highlighted} onChange={(e) => updateItem('skills', skill.id, { is_highlighted: e.target.checked })} />
        Highlight in compact skill summaries
      </label>
      <SkillUsagePanel projects={u.projects} categories={u.technology_categories} />
      <MergeRow
        kind="skill"
        sourceId={skill.id}
        allItems={allSkills.filter((x) => x.id !== skill.id).map((x) => ({ id: x.id, label: resolve(x.name, primaryLocale) }))}
        onMerge={onMerge}
      />
    </>
  )
}

export function SkillsEditor() {
  const { data, primaryLocale, secondaryLocale, addItem, updateItem, replaceData } = useStore()
  const [filter, setFilter] = useState<RegistryFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [view, setView] = useState<'list' | 'category'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)

  const allItems = useMemo(
    () => [...data.skills].sort(
      (a, b) => resolve(a.name, primaryLocale).localeCompare(resolve(b.name, primaryLocale)),
    ),
    [data.skills, primaryLocale],
  )

  // Distinct effective categories (explicit category, else the type label) with
  // a skill count each — drives both the filter dropdown and the editor datalist.
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of allItems) {
      const c = effectiveSkillCategory(s)
      m.set(c, (m.get(c) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [allItems])

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
    let base = allItems
    if (filter === 'unused') base = base.filter((s) => (usage.get(s.id) ?? 0) === 0)
    else if (filter === 'missing-translation') {
      base = base.filter((s) => isMissingTranslation(s.name, primaryLocale, secondaryLocale))
    }
    if (categoryFilter !== 'all') base = base.filter((s) => effectiveSkillCategory(s) === categoryFilter)
    return base
  }, [allItems, usage, filter, categoryFilter, primaryLocale, secondaryLocale])
  // Keep the item being edited present even once its translation is complete
  // (the missing-translation filter would otherwise drop it mid-typing).
  const displayItems = useStableExpanded('skills', items)

  // Batch translation view (frozen so completing a row doesn't yank it).
  const missingItems = useMemo(
    () => allItems.filter((s) => isMissingTranslation(s.name, primaryLocale, secondaryLocale)),
    [allItems, primaryLocale, secondaryLocale],
  )
  const batchRows = useFrozenMissing(filter === 'missing-translation', missingItems, allItems)

  // Bulk-clear: when a specific category is filtered, offer to strip the
  // explicit category off the shown skills so they're auto-categorizable again.
  const clearableIds = useMemo(
    () => (categoryFilter === 'all'
      ? []
      : displayItems.filter((s) => s.category && s.category.trim()).map((s) => s.id)),
    [categoryFilter, displayItems],
  )
  const clearCategories = () => {
    const res = clearSkillCategories(data, clearableIds)
    if (res.cleared > 0) replaceData(res.store)
  }

  const onMerge = (sourceId: string, targetId: string) => void (async () => {
    if (!await confirmMerge('skill', sourceId, targetId, data.skills, primaryLocale, countSkillReferences(data, sourceId))) return
    // replaceData (not loadStore) so the merge enters the undo stack and is
    // picked up by the auto-save effect.
    replaceData(mergeSkills(data, sourceId, targetId))
  })()

  const makeSkill = (name: Skill['name']): Skill => ({
    id: newId(), resume_id: data.resume!.id, name, default_category: null,
    total_duration_in_years: 0, proficiency: 0, is_highlighted: false,
    category: null, created_at: new Date().toISOString(),
  })
  // Datalist for the editor: every real category in use (never "Uncategorized",
  // which is the empty state, not an assignable label).
  const categories = useMemo(
    () => categoryCounts.map(([c]) => c).filter((c) => c !== UNCATEGORIZED_LABEL),
    [categoryCounts],
  )
  const editingSkill = editingId ? data.skills.find((s) => s.id === editingId) ?? null : null
  const add = () => addItem('skills', makeSkill({}))
  // Add a library-suggested skill under the primary locale (matches the
  // autocomplete add path); the user translates via the normal workflow.
  const addNamed = (name: string) => addItem('skills', makeSkill({ [primaryLocale]: name }))

  return (
    <div className="section-pane">
      <p className="registry-note">
        Skills live here once and are referenced by projects and the skills showcase.
        Total experience is computed from linked projects.
      </p>
      <div className="reg-view-toggle" role="group" aria-label="Skill view">
        <button type="button" className={`rvt-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')} aria-pressed={view === 'list'}>
          <List size={14} /> List
        </button>
        <button type="button" className={`rvt-btn ${view === 'category' ? 'active' : ''}`} onClick={() => setView('category')} aria-pressed={view === 'category'}>
          <LayoutGrid size={14} /> By category
        </button>
      </div>

      {view === 'list' ? (
        <>
          <FilterBar filter={filter} onChange={setFilter} counts={counts}
            extra={filter !== 'missing-translation' && categoryCounts.length > 0 ? (
              <>
                <label htmlFor="skill-cat-filter-select" className="scf-label">Category</label>
                <select id="skill-cat-filter-select" className="scf-select"
                  value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                  <option value="all">All categories ({allItems.length})</option>
                  {categoryCounts.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
                </select>
                {clearableIds.length > 0 && (
                  <button type="button" className="scf-clear" onClick={clearCategories}
                    title="Remove this category from these skills so they can be auto-categorized again">
                    Clear all ({clearableIds.length})
                  </button>
                )}
              </>
            ) : undefined} />
          {filter === 'missing-translation' ? (
            <MissingTranslationList label="Skill name" missing={batchRows} all={allItems}
              onSet={(id, name) => updateItem('skills', id, { name })}
              renderEditor={(id) => {
                const s = allItems.find((x) => x.id === id)
                return s ? <SkillEditBody skill={s} allSkills={allItems} categories={categories} onMerge={onMerge} /> : null
              }} />
          ) : (
          <>
          {filter === 'all' && categoryFilter === 'all' && <RelatedSkillsPanel onAdd={addNamed} />}
          {displayItems.length === 0 && (
            <div className="registry-empty">
              {categoryFilter !== 'all'
                ? 'No skills in this category (with the current filter).'
                : filter === 'unused'
                  ? 'No unused skills — every skill is referenced somewhere.'
                  : 'No skills yet — add your first below.'}
            </div>
          )}
          {displayItems.map((s) => {
            const u = usageOfSkill(data, s.id)
            const projectCount = u.projects.length
            const catCount = u.technology_categories.length
            return (
              <EditorCard key={s.id} section="skills" id={s.id}
                title={resolve(s.name, primaryLocale)}
                subtitle={effectiveSkillCategory(s)}
                meta={`${projectCount} project${projectCount === 1 ? '' : 's'} | ${catCount} categor${catCount === 1 ? 'y' : 'ies'}`}
                canStar={false} canDisable={false}
                sortable={false}>
                <SkillEditBody skill={s} allSkills={allItems} categories={categories} onMerge={onMerge} />
              </EditorCard>
            )
          })}
          <AddButton label="Add skill" onClick={add} />
          </>
          )}
        </>
      ) : (
        <>
          <p className="registry-note rcv-hint">Drag a skill onto a category — a quick-drop panel appears on the right so you needn't scroll. The × in a header clears that category from all its skills; click a skill to edit it. Skills with no category are grouped under "Uncategorized".</p>
          <AutoCategorizePanel />
          <RegistryCategoryView
            items={allItems.map((s) => ({
              ...s,
              removable: !!(s.category && s.category.trim()),
            }))}
            unnamed="(unnamed skill)"
            onOpen={setEditingId}
            onRecategorize={(id, cat) => updateItem('skills', id, { category: cat })}
            onRemove={(id) => updateItem('skills', id, { category: null })}
            onClearCategory={(ids) => {
              const res = clearSkillCategories(data, ids)
              if (res.cleared > 0) replaceData(res.store)
            }}
          />
          <AddButton label="Add skill" onClick={add} />
        </>
      )}

      {editingSkill && (
        <RegistryLightbox
          title={resolve(editingSkill.name, primaryLocale) || '(unnamed skill)'}
          ariaLabel="Edit skill"
          onClose={() => setEditingId(null)}
        >
          <SkillEditBody skill={editingSkill} allSkills={allItems} categories={categories} onMerge={onMerge} />
        </RegistryLightbox>
      )}
      <RegistryStyles />
    </div>
  )
}

// ── Role registry ────────────────────────────────────────────────────────────

/**
 * The role's edit fields — shared by the list-view card and the category-view
 * lightbox so both surfaces show the same editor.
 */
function RoleEditBody({ role, allRoles, categories, onMerge }: {
  role: Role
  allRoles: Role[]
  categories: string[]
  onMerge: (sourceId: string, targetId: string) => void
}) {
  const { data, primaryLocale, updateItem } = useStore()
  const u = usageOfRole(data, role.id)
  return (
    <>
      <DualField label="Role name" value={role.name} onChange={(v) => updateItem('roles', role.id, { name: v })} />
      <FieldRow>
        <TextField label="Years of experience" value={role.years_of_experience.toString()} type="number"
          onChange={(v) => updateItem('roles', role.id, { years_of_experience: parseFloat(v) || 0 })} />
        <TextField label="Manual offset (±)" value={role.years_of_experience_offset.toString()} type="number"
          onChange={(v) => updateItem('roles', role.id, { years_of_experience_offset: parseFloat(v) || 0 })} />
        <div className="pf-wrap">
          <span className="pf-label">Category</span>
          <CategoryField
            value={role.category ?? null}
            categories={categories}
            ariaLabel="Category"
            onChange={(v) => updateItem('roles', role.id, { category: v })}
          />
        </div>
      </FieldRow>
      <RoleUsagePanel projects={u.projects} employments={u.work_experiences} />
      <MergeRow
        kind="role"
        sourceId={role.id}
        allItems={allRoles.filter((x) => x.id !== role.id).map((x) => ({ id: x.id, label: resolve(x.name, primaryLocale) }))}
        onMerge={onMerge}
      />
    </>
  )
}

export function RolesEditor() {
  const { data, primaryLocale, secondaryLocale, addItem, updateItem, replaceData } = useStore()
  const [filter, setFilter] = useState<RegistryFilter>('all')
  const [view, setView] = useState<'list' | 'category'>('list')
  // Category view opens the full editor in a lightbox for the clicked role.
  const [editingId, setEditingId] = useState<string | null>(null)

  const sortedItems = useSortedItems('roles')
  const categories = useMemo(() => categoriesOf(sortedItems), [sortedItems])

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
  // Keep the item being edited present past the live filter (see SkillsEditor).
  const displayItems = useStableExpanded('roles', items)

  const missingItems = useMemo(
    () => sortedItems.filter((r) => isMissingTranslation(r.name, primaryLocale, secondaryLocale)),
    [sortedItems, primaryLocale, secondaryLocale],
  )
  const batchRows = useFrozenMissing(filter === 'missing-translation', missingItems, sortedItems)

  const add = () => {
    const r: Role = {
      id: newId(), resume_id: data.resume!.id, name: {}, years_of_experience: 0,
      years_of_experience_offset: 0, starred: false, sort_order: sortedItems.length, disabled: false, category: null,
    }
    addItem('roles', r)
  }

  const onMerge = (sourceId: string, targetId: string) => void (async () => {
    if (!await confirmMerge('role', sourceId, targetId, data.roles, primaryLocale, countRoleReferences(data, sourceId))) return
    replaceData(mergeRoles(data, sourceId, targetId))
  })()

  const editingRole = editingId ? data.roles.find((r) => r.id === editingId) ?? null : null

  return (
    <div className="section-pane">
      <p className="registry-note">Reusable role labels referenced by projects and employments. "Solution Architect" is defined once here.</p>
      <div className="reg-view-toggle" role="group" aria-label="Role view">
        <button type="button" className={`rvt-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')} aria-pressed={view === 'list'}>
          <List size={14} /> List
        </button>
        <button type="button" className={`rvt-btn ${view === 'category' ? 'active' : ''}`} onClick={() => setView('category')} aria-pressed={view === 'category'}>
          <LayoutGrid size={14} /> By category
        </button>
      </div>

      {view === 'list' && filter === 'missing-translation' ? (
        <>
          <FilterBar filter={filter} onChange={setFilter} counts={counts} />
          <MissingTranslationList label="Role name" missing={batchRows} all={sortedItems}
            onSet={(id, name) => updateItem('roles', id, { name })}
            renderEditor={(id) => {
              const r = sortedItems.find((x) => x.id === id)
              return r ? <RoleEditBody role={r} allRoles={sortedItems} categories={categories} onMerge={onMerge} /> : null
            }} />
        </>
      ) : view === 'list' ? (
        <>
          <FilterBar filter={filter} onChange={setFilter} counts={counts} />
          <SortBar section="roles" count={sortedItems.length} />
          {/* SortableList only wraps the rendered slice; reordering with a filter
              active still bakes into sort_order against the visible items, which
              is the intuitive behaviour. */}
          <SortableList section="roles" ids={displayItems.map((x) => x.id)}>
          {displayItems.length === 0 && (
            <div className="registry-empty">
              {filter === 'unused'
                ? 'No unused roles — every role is referenced somewhere.'
                : 'No roles yet — add your first below.'}
            </div>
          )}
          {displayItems.map((r) => {
            const u = usageOfRole(data, r.id)
            const projectCount = u.projects.length
            const empCount = u.work_experiences.length
            return (
              <EditorCard key={r.id} section="roles" id={r.id}
                title={resolve(r.name, primaryLocale)}
                subtitle={r.category ?? undefined}
                meta={`${projectCount} project${projectCount === 1 ? '' : 's'} | ${empCount} employment${empCount === 1 ? '' : 's'}`}
                starred={r.starred} disabled={r.disabled}>
                <RoleEditBody role={r} allRoles={sortedItems} categories={categories} onMerge={onMerge} />
              </EditorCard>
            )
          })}
          </SortableList>
          <AddButton label="Add role" onClick={add} />
        </>
      ) : (
        <>
          <p className="registry-note rcv-hint">Drag a role onto a category — a quick-drop panel appears on the right so you needn't scroll. The × in a header clears that category from all its roles; click a role to edit it.</p>
          <RegistryCategoryView
            items={sortedItems.map((r) => ({ ...r, removable: !!(r.category && r.category.trim()) }))}
            unnamed="(unnamed role)"
            onOpen={setEditingId}
            onRecategorize={(id, cat) => updateItem('roles', id, { category: cat })}
            onRemove={(id) => updateItem('roles', id, { category: null })}
            onClearCategory={(ids) => {
              const set = new Set(ids)
              replaceData({
                ...data,
                roles: data.roles.map((r) => (set.has(r.id) && r.category ? { ...r, category: null } : r)),
              })
            }}
          />
          <AddButton label="Add role" onClick={add} />
        </>
      )}

      {editingRole && (
        <RegistryLightbox
          title={resolve(editingRole.name, primaryLocale) || '(unnamed role)'}
          ariaLabel="Edit role"
          onClose={() => setEditingId(null)}
        >
          <RoleEditBody role={editingRole} allRoles={sortedItems} categories={categories} onMerge={onMerge} />
        </RegistryLightbox>
      )}
      <RegistryStyles />
    </div>
  )
}

// ── Industry registry (A8.1) ─────────────────────────────────────────────────

export function IndustriesEditor() {
  const { data, primaryLocale, secondaryLocale, addItem, updateItem, replaceData } = useStore()
  const [filter, setFilter] = useState<RegistryFilter>('all')

  const sortedItems = useSortedItems('industries')

  const usage = useMemo(
    () => new Map(sortedItems.map((i) => [i.id, countIndustryReferences(data, i.id)])),
    [sortedItems, data],
  )

  const counts = useMemo(() => {
    let unused = 0
    let missing = 0
    for (const ind of sortedItems) {
      if ((usage.get(ind.id) ?? 0) === 0) unused++
      if (isMissingTranslation(ind.name, primaryLocale, secondaryLocale)) missing++
    }
    return { all: sortedItems.length, unused, missing }
  }, [sortedItems, usage, primaryLocale, secondaryLocale])

  const items = useMemo(() => {
    if (filter === 'unused') return sortedItems.filter((i) => (usage.get(i.id) ?? 0) === 0)
    if (filter === 'missing-translation') {
      return sortedItems.filter((i) => isMissingTranslation(i.name, primaryLocale, secondaryLocale))
    }
    return sortedItems
  }, [sortedItems, usage, filter, primaryLocale, secondaryLocale])
  // Keep the item being edited present past the live filter (see SkillsEditor).
  const displayItems = useStableExpanded('industries', items)

  const missingItems = useMemo(
    () => sortedItems.filter((i) => isMissingTranslation(i.name, primaryLocale, secondaryLocale)),
    [sortedItems, primaryLocale, secondaryLocale],
  )
  const batchRows = useFrozenMissing(filter === 'missing-translation', missingItems, sortedItems)

  const add = () => {
    const ind: Industry = {
      id: newId(), resume_id: data.resume!.id, name: {},
      sort_order: sortedItems.length, disabled: false,
    }
    addItem('industries', ind)
  }

  const onMerge = (sourceId: string, targetId: string) => void (async () => {
    if (!await confirmMerge('industry', sourceId, targetId, data.industries, primaryLocale, countIndustryReferences(data, sourceId))) return
    replaceData(mergeIndustries(data, sourceId, targetId))
  })()

  return (
    <div className="section-pane">
      <p className="registry-note">
        Reusable industry / sector labels referenced by projects. Define
        "Finance" once here, then merge duplicates ("finance", "Banking") into it.
      </p>
      <FilterBar filter={filter} onChange={setFilter} counts={counts} />
      {filter === 'missing-translation' ? (
        <MissingTranslationList label="Industry name" missing={batchRows} all={sortedItems}
          onSet={(id, name) => updateItem('industries', id, { name })}
          renderEditor={(id) => {
            const ind = sortedItems.find((x) => x.id === id)
            if (!ind) return null
            const u = usageOfIndustry(data, ind.id)
            return (
              <>
                <DualField label="Industry name" value={ind.name} onChange={(v) => updateItem('industries', ind.id, { name: v })} />
                <IndustryUsagePanel projects={u.projects} />
                <MergeRow
                  kind="industry"
                  sourceId={ind.id}
                  allItems={sortedItems.filter((x) => x.id !== ind.id).map((x) => ({ id: x.id, label: resolve(x.name, primaryLocale) }))}
                  onMerge={onMerge}
                />
              </>
            )
          }} />
      ) : (
      <>
      <SortBar section="industries" count={sortedItems.length} />
      <SortableList section="industries" ids={displayItems.map((x) => x.id)}>
      {displayItems.length === 0 && (
        <div className="registry-empty">
          {filter === 'unused'
            ? 'No unused industries — every industry is referenced by a project.'
            : 'No industries yet — they appear as you set a project industry, or add one below.'}
        </div>
      )}
      {displayItems.map((ind) => {
        const u = usageOfIndustry(data, ind.id)
        const projectCount = u.projects.length
        return (
          <EditorCard key={ind.id} section="industries" id={ind.id}
            title={resolve(ind.name, primaryLocale)}
            meta={`${projectCount} project${projectCount === 1 ? '' : 's'}`}
            disabled={ind.disabled} canStar={false}>
            <DualField label="Industry name" value={ind.name} onChange={(v) => updateItem('industries', ind.id, { name: v })} />
            <IndustryUsagePanel projects={u.projects} />
            <MergeRow
              kind="industry"
              sourceId={ind.id}
              allItems={sortedItems.filter((x) => x.id !== ind.id).map((x) => ({ id: x.id, label: resolve(x.name, primaryLocale) }))}
              onMerge={onMerge}
            />
          </EditorCard>
        )
      })}
      </SortableList>
      <AddButton label="Add industry" onClick={add} />
      </>
      )}
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

/** "Where is this industry used" panel — projects only. */
function IndustryUsagePanel({ projects }: { projects: Project[] }) {
  const { primaryLocale, setActiveSection, setExpandedItem } = useStore()
  if (projects.length === 0) {
    return (
      <div className="usage-block usage-empty">
        <strong>Unused</strong> — no projects reference this industry yet.
      </div>
    )
  }
  return (
    <div className="usage-block">
      <div className="usage-head">Used in</div>
      <div className="usage-sub">{projects.length} project{projects.length === 1 ? '' : 's'}</div>
      {projects.map((p) => (
        <UsageRow
          key={p.id}
          icon={<FolderKanban size={13} />}
          label={`${resolve(p.customer, primaryLocale) || resolve(p.description, primaryLocale) || 'Untitled project'} ${fmtRange(p.start, p.end) ? '· ' + fmtRange(p.start, p.end) : ''}`.trim()}
          onClick={() => { setActiveSection('projects'); setExpandedItem(p.id) }}
        />
      ))}
    </div>
  )
}

// ── Reusable merge UI ───────────────────────────────────────────────────────

/**
 * Show the per-merge confirmation dialog. Returns true if the user accepted
 * AND the merge has a valid (different, both-present) source/target pair.
 */
async function confirmMerge(
  kind: 'skill' | 'role' | 'industry',
  sourceId: string,
  targetId: string,
  registry: ReadonlyArray<{ id: string; name: LocalizedString }>,
  locale: string,
  refs: number,
): Promise<boolean> {
  if (!targetId || sourceId === targetId) return false
  const source = registry.find((x) => x.id === sourceId)
  const target = registry.find((x) => x.id === targetId)
  if (!source || !target) return false
  const sName = resolve(source.name, locale) || `(unnamed ${kind})`
  const tName = resolve(target.name, locale) || `(unnamed ${kind})`
  const plural = refs === 1 ? '' : 's'
  return confirmDialog({
    title: `Merge ${kind}`,
    message: `Merge "${sName}" into "${tName}"? This rewrites ${refs} reference${plural} and deletes "${sName}".`,
    confirmLabel: 'Merge', undoHint: true,
  })
}

interface MergeOption { id: string; label: string }

function MergeRow({
  kind, sourceId, allItems, onMerge,
}: {
  kind: 'skill' | 'role' | 'industry'
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
        aria-label={`Merge this ${kind} into another`}
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
      default_category: null, total_duration_in_years: 0,
      proficiency: 0, is_highlighted: false, created_at: new Date().toISOString(),
    }
    addItem('skills', skill, { open: false }) // don't collapse this category card
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
                  sublabel: s.category?.trim() || undefined,
                }))}
              onPick={(skillId) => linkSkillIntoCategory(cat.id, skillId)}
              onAddNew={(text) => createSkillAndLink(cat.id, text)}
              addLabel="skill"
              placeholder="Search or add a skill…"
              suggestExtra={suggestSkillNames(() =>
                useStore.getState().data.skills.map((s) => resolve(s.name, primaryLocale)),
              )}
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
 * Generic dual-language translation popover. Renders a DualField bound to a
 * LocalizedString, with a heading and a footnote, dismissing on outside click.
 * Used by skill chips, role chips, and the employment role pill.
 */
export function TranslationPopover({
  title, fieldLabel, value, footnote, onClose, onChange,
}: {
  title: string
  fieldLabel: string
  value: LocalizedString
  footnote?: string
  onClose: () => void
  onChange: (value: LocalizedString) => void
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
      <div className="stp-head">{title}</div>
      <DualField label={fieldLabel} value={value} onChange={onChange} />
      {footnote && <div className="stp-foot">{footnote}</div>}
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

/**
 * Shared popover used by both CategorySkillChip and the ProjectsEditor's
 * project-skill chip. Edits the registry Skill's name — a thin wrapper over
 * the generic TranslationPopover.
 */
export function SkillTranslationPopover({
  skill, onClose, onChange,
}: {
  skill: Skill
  onClose: () => void
  onChange: (name: LocalizedString) => void
}) {
  return (
    <TranslationPopover
      title={`Edit “${Object.values(skill.name)[0] || 'skill'}” translation`}
      fieldLabel="Skill name"
      value={skill.name}
      footnote="Changes the registry — all references update."
      onClose={onClose}
      onChange={onChange}
    />
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
      /* List / By-category view toggle */
      .reg-view-toggle { display: inline-flex; gap: 2px; padding: 3px; margin-bottom: 14px;
        background: var(--paper-sunken); border-radius: var(--r-md); }
      .rvt-btn {
        display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
        font-size: 12.5px; font-weight: 600; color: var(--ink-soft);
        border-radius: var(--r-sm); transition: color .12s, background .12s;
      }
      .rvt-btn:hover { color: var(--accent); }
      .rvt-btn.active { background: var(--paper); color: var(--accent); box-shadow: var(--shadow-sm); }
      .rcv-hint { border-left-color: var(--secondary-ink-text, var(--accent)); }
      /* Category view: grouped, compact, drag-to-recategorize */
      .rcv { display: flex; flex-direction: column; gap: 14px; margin-bottom: 12px; }
      .rcv-group { border: 1px solid var(--line); border-radius: var(--r-md); overflow: hidden; }
      .rcv-head {
        display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 8px 7px 13px;
        font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
        color: var(--ink-soft); background: var(--paper-sunken);
        border-bottom: 1px solid var(--line); transition: background .12s, color .12s, box-shadow .12s;
      }
      .rcv-head-label { display: inline-flex; align-items: center; gap: 8px; }
      .rcv-head.is-over { background: var(--accent-wash); color: var(--accent); box-shadow: inset 0 0 0 2px var(--accent); }
      .rcv-head-x {
        display: grid; place-items: center; width: 24px; height: 24px; flex-shrink: 0;
        color: var(--ink-faint); border-radius: var(--r-sm);
        transition: color .12s, background .12s;
      }
      .rcv-head-x:hover { color: #b91c1c; background: #fef2f2; }
      .rcv-count { font-weight: 700; color: var(--ink-faint); font-variant-numeric: tabular-nums; }
      /* Floating quick-select drop panel (shown while dragging a chip) */
      .rcv-drop-panel {
        position: fixed; top: 50%; right: 18px; transform: translateY(-50%);
        z-index: 60; width: 232px; max-height: 78vh; display: flex; flex-direction: column;
        background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-md);
        box-shadow: var(--shadow-lg); overflow: hidden; animation: fadeIn .12s ease;
      }
      .rcv-drop-title {
        padding: 9px 12px; font-size: 11px; font-weight: 700; letter-spacing: .05em;
        text-transform: uppercase; color: var(--ink-faint);
        background: var(--paper-sunken); border-bottom: 1px solid var(--line);
      }
      .rcv-drop-list { overflow-y: auto; overscroll-behavior: contain; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
      .rcv-drop-row {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 9px 11px; border-radius: var(--r-sm); font-size: 13px; font-weight: 600;
        color: var(--ink-soft); background: var(--paper-raised); border: 1px dashed var(--line);
        transition: color .12s, background .12s, border-color .12s, box-shadow .12s;
      }
      .rcv-drop-row.is-over {
        color: var(--accent); background: var(--accent-wash);
        border-color: var(--accent); border-style: solid; box-shadow: 0 0 0 2px var(--accent) inset;
      }
      .rcv-drop-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .rcv-chips { display: flex; flex-wrap: wrap; gap: 7px; padding: 12px 13px; min-height: 20px; }
      .rcv-chip-wrap { display: inline-flex; align-items: stretch; }
      .rcv-chip-wrap.is-dragging { opacity: .6; box-shadow: var(--shadow-md); z-index: 20; position: relative; border-radius: 16px; }
      .rcv-chip-wrap.is-dragging .rcv-chip { cursor: grabbing; }
      .rcv-chip {
        padding: 6px 12px; font-size: 13px; font-weight: 500; color: var(--ink);
        background: var(--paper-raised); border: 1px solid var(--line); border-radius: 16px;
        cursor: grab; touch-action: none; transition: color .12s, border-color .12s, background .12s;
      }
      .rcv-chip:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-wash); }
      .rcv-chip.has-x { border-top-right-radius: 0; border-bottom-right-radius: 0; border-right: none; }
      .rcv-chip-x {
        display: grid; place-items: center; width: 24px; flex-shrink: 0;
        color: var(--ink-faint); background: var(--paper-raised);
        border: 1px solid var(--line); border-left: none;
        border-top-right-radius: 16px; border-bottom-right-radius: 16px;
        transition: color .12s, background .12s;
      }
      .rcv-chip-x:hover { color: #b91c1c; background: #fef2f2; }
      /* Related-skill suggestions (F12 pt3) */
      .rsp {
        margin-bottom: 16px; padding: 11px 14px;
        background: var(--accent-wash); border: 1px solid var(--secondary-line, var(--line));
        border-radius: var(--r-md);
      }
      .rsp-label {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 12px; font-weight: 600; color: var(--accent);
        text-transform: uppercase; letter-spacing: .03em; margin-bottom: 8px;
      }
      .rsp-chips { display: flex; flex-wrap: wrap; gap: 7px; }
      .rsp-chip {
        display: inline-flex; align-items: stretch;
        border: 1px solid var(--accent); border-radius: 14px; overflow: hidden;
        background: var(--paper);
      }
      .rsp-add {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 4px 9px; font-size: 12.5px; font-weight: 500; color: var(--accent);
        background: transparent; transition: background .12s;
      }
      .rsp-add:hover { background: var(--accent); color: #fff; }
      .rsp-x {
        display: grid; place-items: center; width: 22px;
        color: var(--ink-faint); border-left: 1px solid var(--line);
        transition: color .12s, background .12s;
      }
      .rsp-x:hover { color: #b91c1c; background: #fef2f2; }
      /* Auto-categorize panel */
      .acp {
        display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px;
        margin-bottom: 14px; padding: 10px 14px;
        background: var(--accent-wash); border: 1px solid var(--secondary-line, var(--line));
        border-radius: var(--r-md);
      }
      .acp-text {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 12.5px; color: var(--ink-soft); flex: 1 1 auto; min-width: 220px;
      }
      .acp-text svg { color: var(--accent); flex-shrink: 0; }
      .acp-done { color: var(--ok-ink, var(--accent)); }
      .acp-done svg { color: var(--ok-ink, var(--accent)); }
      .acp-btn {
        display: inline-flex; align-items: center; padding: 6px 14px;
        font-size: 12.5px; font-weight: 600; color: #fff; background: var(--accent);
        border-radius: var(--r-sm); transition: background .12s; flex-shrink: 0;
      }
      .acp-btn:hover { background: var(--accent-bright, var(--accent)); }
      /* Category filter dropdown (skills list view) */
      .skill-cat-filter { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
      .scf-label { font-size: 12px; font-weight: 600; color: var(--ink-soft); }
      .scf-select {
        font: inherit; font-size: 13px; padding: 5px 8px;
        border: 1px solid var(--line); border-radius: var(--r-sm);
        background: var(--paper); color: var(--ink); max-width: 320px;
      }
      .scf-clear {
        font: inherit; font-size: 12.5px; font-weight: 500; padding: 5px 11px;
        border: 1px solid var(--line); border-radius: var(--r-sm);
        background: var(--paper); color: var(--ink-soft);
        transition: color .12s, border-color .12s, background .12s;
      }
      .scf-clear:hover { color: #b91c1c; border-color: #f2c2c2; background: #fef2f2; }
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
        border: 1px solid transparent; transition: color .12s, background .12s, border-color .12s, box-shadow .12s;
        font-size: 13px; color: var(--ink); margin-bottom: 4px;
      }
      .ur-row:hover { border-color: var(--accent); color: var(--accent); }
      .ur-icon { color: var(--ink-faint); display: grid; place-items: center; }
      .ur-row:hover .ur-icon { color: var(--accent); }
      .ur-label { flex: 1; }
    `}</style>
  )
}
