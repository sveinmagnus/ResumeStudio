/**
 * The "where is this used" panel inside a registry card.
 *
 * Skills, Roles and Industries each had their own copy — Skill's and
 * Industry's were the same component with a different empty-state sentence,
 * and Role's was that plus two more groups. The project/employment/position
 * label expression (`customer || description || 'Untitled project'` + date
 * range) was written out verbatim three times.
 *
 * Clicking a row navigates the editor to that section and expands the item.
 */
import { Briefcase, FolderKanban, Users } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { resolve, fmtRange } from '../../lib/locales'
import type { Project, WorkExperience, Position, YearMonth, LocalizedString } from '../../types'

/** One navigable group of usage rows. */
export interface UsageGroup {
  /** Plural noun for the count line, e.g. "project". */
  noun: string
  section: string
  icon: 'project' | 'employment' | 'position'
  rows: Array<{ id: string; label: string }>
}

const ICONS = {
  project: FolderKanban,
  employment: Briefcase,
  position: Users,
} as const

/**
 * The shared "title · date range" label for a usage row: the first non-empty
 * of the candidate fields, then the range if there is one.
 */
function usageLabel(
  locale: string,
  candidates: Array<LocalizedString | undefined>,
  fallback: string,
  start: YearMonth | null,
  end: YearMonth | null,
): string {
  const title = candidates.map((c) => resolve(c, locale)).find(Boolean) || fallback
  const range = fmtRange(start, end)
  return range ? `${title} · ${range}` : title
}

export function projectGroup(projects: Project[], locale: string): UsageGroup {
  return {
    noun: 'project', section: 'projects', icon: 'project',
    rows: projects.map((p) => ({
      id: p.id,
      label: usageLabel(locale, [p.customer, p.description], 'Untitled project', p.start, p.end),
    })),
  }
}

export function employmentGroup(items: WorkExperience[], locale: string): UsageGroup {
  return {
    noun: 'employment', section: 'work_experiences', icon: 'employment',
    rows: items.map((w) => ({
      id: w.id,
      label: usageLabel(locale, [w.employer], 'Untitled employer', w.start, w.end),
    })),
  }
}

export function positionGroup(items: Position[], locale: string): UsageGroup {
  return {
    noun: 'other role', section: 'positions', icon: 'position',
    rows: items.map((pos) => ({
      id: pos.id,
      label: usageLabel(locale, [pos.name, pos.organisation], 'Untitled role', pos.start, pos.end),
    })),
  }
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

export function UsagePanel({ groups, emptyNote }: {
  groups: UsageGroup[]
  /** Shown after the bold "Unused" when nothing references this entry. */
  emptyNote: string
}) {
  const { setActiveSection, setExpandedItem } = useStore()
  const nonEmpty = groups.filter((g) => g.rows.length > 0)

  if (nonEmpty.length === 0) {
    return (
      <div className="usage-block usage-empty">
        <strong>Unused</strong> — {emptyNote}
      </div>
    )
  }

  const goto = (section: string, id: string) => {
    setActiveSection(section)
    setExpandedItem(id)
  }

  return (
    <div className="usage-block">
      <div className="usage-head">Used in</div>
      {nonEmpty.map((g) => {
        const Icon = ICONS[g.icon]
        return (
          <div key={g.section}>
            <div className="usage-sub">{plural(g.rows.length, g.noun)}</div>
            {g.rows.map((row) => (
              <button key={row.id} type="button" className="ur-row" onClick={() => goto(g.section, row.id)}>
                <span className="ur-icon"><Icon size={13} /></span>
                <span className="ur-label">{row.label}</span>
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}
