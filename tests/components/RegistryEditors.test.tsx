/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  SkillsEditor, RolesEditor, IndustriesEditor, ReferencesEditor,
} from '../../src/components/editor/RegistryEditors'
import { useStore } from '../../src/store/useStore'
import {
  setSkillRelationsForTest, setSkillDomainsForTest, setSkillDomainModelForTest,
} from '../../src/lib/skillTaxonomy'
import { resetStore } from '../helpers/store-reset'
import { resolveConfirm } from '../helpers/confirm'
import { emptyStore, makeSkill, makeSkillCategory, makeProject, makeIndustry, makeRole } from '../fixtures'
import type { ResumeStore } from '../../src/types'

function seed(data: ResumeStore = emptyStore()) {
  useStore.setState({
    data, hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'skills', expandedItemId: null, mutationCount: 0,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  setSkillRelationsForTest(null)
  setSkillDomainsForTest(null)
  setSkillDomainModelForTest(null)
})

describe('<SkillsEditor> — add + merge', () => {
  beforeEach(() => resetStore())

  it('adds a skill to the registry', async () => {
    seed()
    render(<SkillsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /add skill/i }))
    expect(useStore.getState().data.skills).toHaveLength(1)
  })

  it('suggests related skills from the library graph and adds the picked one', async () => {
    setSkillRelationsForTest({
      Scrum: ['Agile Software Development', 'Kanban'],
      'Agile Software Development': ['Scrum'],
      Kanban: ['Scrum'],
    })
    seed({ ...emptyStore(), skills: [makeSkill({ id: 's1', name: { en: 'Scrum' } })] })
    render(<SkillsEditor />)

    // The lazy relations load resolves, then the suggestion chip appears.
    // The add button's accessible name is its visible text.
    const chip = await screen.findByRole('button', { name: 'Agile Software Development' })
    await userEvent.click(chip)

    const skills = useStore.getState().data.skills
    expect(skills).toHaveLength(2)
    expect(skills.some((s) => s.name.en === 'Agile Software Development')).toBe(true)
  })

  it('auto-categorizes uncategorized skills from the library in the By category view', async () => {
    setSkillDomainsForTest({ TypeScript: 'Software Development', Kubernetes: 'Cloud & Infrastructure' })
    setSkillRelationsForTest({})
    setSkillDomainModelForTest({}) // exact matches only — no semantic guessing here
    const kept = makeSkillCategory({ id: 'kept', name: { en: 'Kept' } })
    seed({
      ...emptyStore(),
      skill_categories: [kept],
      skills: [
        makeSkill({ id: 's1', name: { en: 'TypeScript' } }),
        makeSkill({ id: 's2', name: { en: 'Kubernetes' } }),
        makeSkill({ id: 's3', name: { en: 'My Frontend' }, category_id: 'kept' }),
      ],
    })
    render(<SkillsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /by category/i }))

    // Panel appears once the lazy domain map resolves (2 fillable, s3 is set).
    const btn = await screen.findByRole('button', { name: /auto-categorize 2/i })
    await userEvent.click(btn)

    const data = useStore.getState().data
    const nameOf = (id: string | null) => data.skill_categories!.find((c) => c.id === id)?.name.en
    const skills = data.skills
    expect(nameOf(skills.find((s) => s.id === 's1')!.category_id!)).toBe('Software Development')
    expect(nameOf(skills.find((s) => s.id === 's2')!.category_id!)).toBe('Cloud & Infrastructure')
    expect(skills.find((s) => s.id === 's3')!.category_id).toBe('kept') // manual category untouched
  })

  it('filters the skills list by effective category, with per-category counts', async () => {
    seed({
      ...emptyStore(),
      skill_categories: [
        makeSkillCategory({ id: 'frontend', name: { en: 'Frontend' } }),
        makeSkillCategory({ id: 'data', name: { en: 'Data' } }),
      ],
      skills: [
        makeSkill({ id: 's1', name: { en: 'React' }, category_id: 'frontend' }),
        makeSkill({ id: 's2', name: { en: 'Vue' }, category_id: 'frontend' }),
        makeSkill({ id: 's3', name: { en: 'Postgres' }, category_id: 'data' }),
        makeSkill({ id: 's4', name: { en: 'Leadership' }, category_id: null }),
      ],
    })
    render(<SkillsEditor />)

    // Dropdown lists each used category with a count; the skill with no
    // category counts under "Uncategorized".
    const select = screen.getByLabelText('Category') as HTMLSelectElement
    const optionText = [...select.options].map((o) => o.textContent)
    expect(optionText).toEqual(expect.arrayContaining([
      'All categories (4)', 'Data (1)', 'Frontend (2)', 'Uncategorized (1)',
    ]))

    // Selecting "Frontend" (by its category id) narrows the list to its two skills.
    await userEvent.selectOptions(select, 'frontend')
    expect(screen.getByText('React')).toBeInTheDocument()
    expect(screen.getByText('Vue')).toBeInTheDocument()
    expect(screen.queryByText('Postgres')).not.toBeInTheDocument()
    expect(screen.queryByText('Leadership')).not.toBeInTheDocument()
  })

  it('removes a skill\'s category via the chip "x" in the By category view', async () => {
    seed({
      ...emptyStore(),
      skill_categories: [makeSkillCategory({ id: 'frontend', name: { en: 'Frontend' } })],
      skills: [
        makeSkill({ id: 's1', name: { en: 'React' }, category_id: 'frontend' }),
        makeSkill({ id: 's2', name: { en: 'Vue' }, category_id: 'frontend' }),
      ],
    })
    render(<SkillsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /by category/i }))

    // The "x" clears the explicit category (React becomes Uncategorized).
    await userEvent.click(screen.getByRole('button', { name: /remove category from React/i }))
    expect(useStore.getState().data.skills.find((s) => s.id === 's1')!.category_id).toBeNull()
    expect(useStore.getState().data.skills.find((s) => s.id === 's2')!.category_id).toBe('frontend')
  })

  it('deletes a category from the filter bar, unassigning its skills', async () => {
    seed({
      ...emptyStore(),
      skill_categories: [
        makeSkillCategory({ id: 'frontend', name: { en: 'Frontend' } }),
        makeSkillCategory({ id: 'data', name: { en: 'Data' } }),
      ],
      skills: [
        makeSkill({ id: 's1', name: { en: 'React' }, category_id: 'frontend' }),
        makeSkill({ id: 's2', name: { en: 'Vue' }, category_id: 'frontend' }),
        makeSkill({ id: 's3', name: { en: 'Postgres' }, category_id: 'data' }),
      ],
    })
    render(<SkillsEditor />)

    // Filter to Frontend, then delete the category outright.
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'frontend')
    await userEvent.click(screen.getByRole('button', { name: /delete category and all skill assignments/i }))

    const skills = useStore.getState().data.skills
    expect(skills.find((s) => s.id === 's1')!.category_id).toBeNull()
    expect(skills.find((s) => s.id === 's2')!.category_id).toBeNull()
    expect(skills.find((s) => s.id === 's3')!.category_id).toBe('data') // untouched
  })

  it('dismisses a related-skill suggestion without adding it', async () => {
    setSkillRelationsForTest({ Scrum: ['Kanban'], Kanban: ['Scrum'] })
    seed({ ...emptyStore(), skills: [makeSkill({ id: 's1', name: { en: 'Scrum' } })] })
    render(<SkillsEditor />)

    await screen.findByRole('button', { name: 'Kanban' })
    await userEvent.click(screen.getByRole('button', { name: /Dismiss Kanban/i }))

    expect(screen.queryByRole('button', { name: 'Kanban' })).not.toBeInTheDocument()
    expect(useStore.getState().data.skills).toHaveLength(1) // nothing added
  })

  it('merges one skill into another when confirmed', async () => {
    const a = makeSkill({ name: { en: 'Old' } })
    const b = makeSkill({ name: { en: 'React' } })
    // A project references the source so the merge has something to rewrite.
    const project = makeProject({
      skills: [{ id: 'ps1', skill_id: a.id, name: a.name, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 }],
    })
    seed({ ...emptyStore(), skills: [a, b], projects: [project] })
    useStore.setState({ expandedItemId: a.id })

    render(<SkillsEditor />)
    await userEvent.selectOptions(
      screen.getByDisplayValue('— pick a target —'),
      screen.getByRole('option', { name: 'React' }),
    )
    await resolveConfirm('confirm')

    const skills = useStore.getState().data.skills
    expect(skills).toHaveLength(1)        // source removed
    expect(skills[0].name.en).toBe('React')
    // The project's reference was rewritten to the target.
    expect(useStore.getState().data.projects[0].skills[0].skill_id).toBe(b.id)
  })

  it('does not merge when the confirm dialog is declined', async () => {
    const a = makeSkill({ name: { en: 'Old' } })
    const b = makeSkill({ name: { en: 'React' } })
    seed({ ...emptyStore(), skills: [a, b] })
    useStore.setState({ expandedItemId: a.id })

    render(<SkillsEditor />)
    await userEvent.selectOptions(
      screen.getByDisplayValue('— pick a target —'),
      screen.getByRole('option', { name: 'React' }),
    )
    await resolveConfirm('cancel')
    expect(useStore.getState().data.skills).toHaveLength(2)
  })
})

describe('<RolesEditor>', () => {
  beforeEach(() => resetStore())
  it('adds a role', async () => {
    seed()
    render(<RolesEditor />)
    await userEvent.click(screen.getByRole('button', { name: /add role/i }))
    expect(useStore.getState().data.roles).toHaveLength(1)
  })
})

describe('<ReferencesEditor>', () => {
  beforeEach(() => resetStore())

  it('adds a reference and toggles its export inclusion', async () => {
    seed()
    render(<ReferencesEditor />)
    await userEvent.click(screen.getByRole('button', { name: /add reference/i }))
    const refId = useStore.getState().data.references[0].id
    expect(useStore.getState().expandedItemId).toBe(refId)

    await userEvent.click(screen.getByRole('checkbox'))
    expect(useStore.getState().data.references[0].include_in_exports).toBe(true)
  })
})

describe('<IndustriesEditor> (A8.1)', () => {
  beforeEach(() => resetStore())

  function seedInd(data: ResumeStore) {
    useStore.setState({
      data, hasData: true, primaryLocale: 'en', secondaryLocale: null,
      activeSection: 'industries', expandedItemId: null, mutationCount: 0,
    })
  }

  it('adds an industry to the registry', async () => {
    seedInd(emptyStore())
    render(<IndustriesEditor />)
    await userEvent.click(screen.getByRole('button', { name: /add industry/i }))
    expect(useStore.getState().data.industries).toHaveLength(1)
  })

  it('merges one industry into another, rewriting the linked project', async () => {
    const a = makeIndustry({ id: 'a', name: { en: 'finance' } })
    const b = makeIndustry({ id: 'b', name: { en: 'Finance' } })
    const project = makeProject({ id: 'p', industries: [{ id: 'pi1', industry_id: 'a', name: { en: 'finance' }, sort_order: 0 }] })
    seedInd({ ...emptyStore(), industries: [a, b], projects: [project] })
    useStore.setState({ expandedItemId: 'a' })

    render(<IndustriesEditor />)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /merge this industry/i }),
      screen.getByRole('option', { name: 'Finance' }),
    )
    await resolveConfirm('confirm')

    const industries = useStore.getState().data.industries
    expect(industries).toHaveLength(1)         // source removed
    expect(industries[0].id).toBe('b')
    expect(useStore.getState().data.projects[0].industries[0].industry_id).toBe('b') // ref rewritten
  })
})

describe('<SkillsEditor> — batch missing-translation view', () => {
  beforeEach(() => resetStore())

  it('edits translations inline and keeps a completed row (frozen) with a "done" mark', async () => {
    useStore.setState({
      data: {
        ...emptyStore(),
        skills: [
          makeSkill({ id: 's1', name: { en: 'TypeScript' } }),          // missing 'no'
          makeSkill({ id: 's2', name: { en: 'React', no: 'React' } }),  // complete
        ],
      },
      hasData: true, primaryLocale: 'en', secondaryLocale: 'no',
      activeSection: 'skills', expandedItemId: null, mutationCount: 0,
    })
    render(<SkillsEditor />)

    // The batch list shows the untranslated skill's DualField directly — no
    // card to open. Only s1 is missing, so there's one Norwegian input.
    await userEvent.click(screen.getByRole('button', { name: /missing translation/i }))
    const noInput = screen.getByLabelText(/Skill name \(Norsk\)/i)
    await userEvent.type(noInput, 'TypeScript')

    // Completing it would normally drop it from the filter; the frozen list
    // keeps the row mounted and marks it done.
    expect(useStore.getState().data.skills.find((s) => s.id === 's1')!.name.no).toBe('TypeScript')
    expect(screen.getByLabelText(/Skill name \(Norsk\)/i)).toBeInTheDocument()
    expect(screen.getByText(/done/i)).toBeInTheDocument()
  })

  function seedTwo() {
    useStore.setState({
      data: {
        ...emptyStore(),
        skills: [
          makeSkill({ id: 's1', name: { en: 'TypeScript' } }),          // missing 'no'
          makeSkill({ id: 's2', name: { en: 'React', no: 'React' } }),  // complete
        ],
      },
      hasData: true, primaryLocale: 'en', secondaryLocale: 'no',
      activeSection: 'skills', expandedItemId: null, mutationCount: 0,
    })
  }

  it('the "Show all" toggle reveals already-translated entries for review', async () => {
    seedTwo()
    render(<SkillsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /missing translation/i }))

    // Only the missing skill is shown by default (one Norwegian input).
    expect(screen.getAllByLabelText(/Skill name \(Norsk\)/i)).toHaveLength(1)

    // Toggling "Show all" reveals both (the completed React too).
    await userEvent.click(screen.getByLabelText(/show all/i))
    expect(screen.getAllByLabelText(/Skill name \(Norsk\)/i)).toHaveLength(2)
  })

  it('opens the full editor inline for a batch row', async () => {
    seedTwo()
    render(<SkillsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /missing translation/i }))

    // The compact row has no Proficiency field; opening the full editor reveals it.
    expect(screen.queryByText(/Proficiency/i)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /open full editor/i }))
    expect(screen.getByText(/Proficiency/i)).toBeInTheDocument()
  })
})

describe('<RolesEditor> — category view', () => {
  beforeEach(() => resetStore())

  function seedRoles() {
    useStore.setState({
      data: {
        ...emptyStore(),
        roles: [
          makeRole({ id: 'r1', name: { en: 'Solution Architect' }, category: 'Architecture' }),
          makeRole({ id: 'r2', name: { en: 'Backend Developer' }, category: 'Development' }),
          makeRole({ id: 'r3', name: { en: 'Scrum Master' } }), // uncategorized
        ],
      },
      hasData: true, primaryLocale: 'en', secondaryLocale: null,
      activeSection: 'roles', expandedItemId: null, mutationCount: 0,
    })
  }

  it('groups roles by category with an Uncategorized bucket and compact chips', async () => {
    seedRoles()
    render(<RolesEditor />)
    await userEvent.click(screen.getByRole('button', { name: /by category/i }))
    expect(screen.getByText('Architecture')).toBeInTheDocument()
    expect(screen.getByText('Development')).toBeInTheDocument()
    expect(screen.getByText('Uncategorized')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Solution Architect' })).toBeInTheDocument()
  })

  it('opens the edit lightbox on chip click and assigns a category', async () => {
    seedRoles()
    render(<RolesEditor />)
    await userEvent.click(screen.getByRole('button', { name: /by category/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Scrum Master' }))

    const dialog = await screen.findByRole('dialog', { name: /edit role/i })
    expect(within(dialog).getByLabelText(/Role name/i)).toBeInTheDocument()

    await userEvent.type(within(dialog).getByPlaceholderText('Uncategorized'), 'Agile')
    await userEvent.tab() // the category field commits on blur
    expect(useStore.getState().data.roles.find((r) => r.id === 'r3')!.category).toBe('Agile')
  })
})

describe('<SkillsEditor> — category view', () => {
  beforeEach(() => resetStore())

  function seedSkills() {
    useStore.setState({
      data: {
        ...emptyStore(),
        skill_categories: [
          makeSkillCategory({ id: 'frontend', name: { en: 'Frontend' } }),
          makeSkillCategory({ id: 'data', name: { en: 'Data' } }),
        ],
        skills: [
          makeSkill({ id: 's1', name: { en: 'React' }, category_id: 'frontend' }),
          makeSkill({ id: 's2', name: { en: 'PostgreSQL' }, category_id: 'data' }),
          makeSkill({ id: 's3', name: { en: 'Docker' } }), // uncategorized
        ],
      },
      hasData: true, primaryLocale: 'en', secondaryLocale: null,
      activeSection: 'skills', expandedItemId: null, mutationCount: 0,
    })
  }

  it('groups skills by category — skills with no category go under "Uncategorized"', async () => {
    seedSkills()
    render(<SkillsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /by category/i }))
    expect(screen.getByText('Frontend')).toBeInTheDocument()
    expect(screen.getByText('Data')).toBeInTheDocument()
    // Docker has no explicit category → "Uncategorized" (no type fallback).
    expect(screen.getByText('Uncategorized')).toBeInTheDocument()
    expect(screen.queryByText('Technical')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'React' })).toBeInTheDocument()
  })

  it('opens the edit lightbox on chip click and assigns a category', async () => {
    seedSkills()
    render(<SkillsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /by category/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Docker' }))

    const dialog = await screen.findByRole('dialog', { name: /edit skill/i })
    expect(within(dialog).getByLabelText(/Skill name/i)).toBeInTheDocument()

    // The category input's placeholder is the empty-state label ('Uncategorized').
    // The field commits on blur (Tab), like a normal autocomplete.
    await userEvent.type(within(dialog).getByPlaceholderText('Uncategorized'), 'DevOps')
    await userEvent.tab()
    const data = useStore.getState().data
    const s3 = data.skills.find((s) => s.id === 's3')!
    expect(data.skill_categories!.find((c) => c.id === s3.category_id)?.name.en).toBe('DevOps')
  })

  it('lets you type a multi-word category (spaces are not stripped mid-typing)', async () => {
    seedSkills()
    render(<SkillsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /by category/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Docker' }))
    const dialog = await screen.findByRole('dialog', { name: /edit skill/i })

    const input = within(dialog).getByPlaceholderText('Uncategorized')
    await userEvent.type(input, 'Cloud Native')
    expect((input as HTMLInputElement).value).toBe('Cloud Native') // space kept while typing
    await userEvent.tab()
    const data = useStore.getState().data
    const s3 = data.skills.find((s) => s.id === 's3')!
    expect(data.skill_categories!.find((c) => c.id === s3.category_id)?.name.en).toBe('Cloud Native')
  })

  it('offers a distinct "New category" row when typing a value that does not exist', async () => {
    seedSkills()
    render(<SkillsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /by category/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Docker' }))
    const dialog = await screen.findByRole('dialog', { name: /edit skill/i })

    // Typing an existing category surfaces it as an option (pick, not create)…
    const input = within(dialog).getByPlaceholderText('Uncategorized')
    await userEvent.type(input, 'Front')
    expect(within(dialog).getByRole('option', { name: 'Frontend' })).toBeInTheDocument()
    // …typing a novel value shows the explicit "New category" affordance.
    await userEvent.clear(input)
    await userEvent.type(input, 'Observability')
    expect(within(dialog).getByRole('option', { name: /New category/i })).toBeInTheDocument()
  })

  it('deletes a whole category via the trash button in its header', async () => {
    seedSkills()
    render(<SkillsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /by category/i }))

    // Frontend has one skill (React); deleting the category unassigns it.
    await userEvent.click(screen.getByRole('button', { name: /Delete category "Frontend"/i }))
    expect(useStore.getState().data.skills.find((s) => s.id === 's1')!.category_id).toBeNull()
    // The Uncategorized group has no delete button.
    expect(screen.queryByRole('button', { name: /Delete category "Uncategorized"/i })).not.toBeInTheDocument()
  })

  it('keeps an emptied category in the By-category view until it is deleted', async () => {
    // skill_categories is what makes a category persist (populated by
    // assignment/migration in real use).
    useStore.setState({
      data: {
        ...emptyStore(),
        skills: [makeSkill({ id: 's1', name: { en: 'React' }, category_id: 'frontend' })],
        skill_categories: [makeSkillCategory({ id: 'frontend', name: { en: 'Frontend' } })],
      },
      hasData: true, primaryLocale: 'en', secondaryLocale: null,
      activeSection: 'skills', expandedItemId: null, mutationCount: 0,
    })
    render(<SkillsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /by category/i }))

    // Remove React's category via the chip "×": Frontend becomes empty but stays.
    await userEvent.click(screen.getByRole('button', { name: /remove category from React/i }))
    expect(useStore.getState().data.skills.find((s) => s.id === 's1')!.category_id).toBeNull()
    expect(screen.getByText('Frontend')).toBeInTheDocument() // header persists (0 skills)
    // Deleting it (trash) removes the category for good.
    await userEvent.click(screen.getByRole('button', { name: /Delete category "Frontend"/i }))
    expect(screen.queryByText('Frontend')).not.toBeInTheDocument()
    expect(useStore.getState().data.skill_categories).toEqual([])
  })

  it('reorders categories with the ↑/↓ header buttons (curated sort_order, not alphabetical)', async () => {
    seedSkills() // Frontend (sort_order 0), Data (sort_order 1)
    render(<SkillsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /by category/i }))

    expect(useStore.getState().data.skill_categories!.map((c) => c.name.en)).toEqual(['Frontend', 'Data'])
    // Frontend is first — its "up" button is disabled; move it down instead.
    expect(screen.getByRole('button', { name: /Move category "Frontend" up/i })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /Move category "Frontend" down/i }))

    const cats = useStore.getState().data.skill_categories!
    expect(cats.map((c) => c.name.en)).toEqual(['Data', 'Frontend'])
    // Now Data is first: its "up" is disabled, Frontend's "down" is disabled.
    expect(screen.getByRole('button', { name: /Move category "Data" up/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Move category "Frontend" down/i })).toBeDisabled()
  })

  it('never offers reorder/rename controls on the Uncategorized group', async () => {
    seedSkills()
    render(<SkillsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /by category/i }))
    expect(screen.queryByRole('button', { name: /Move category "Uncategorized"/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Rename category "Uncategorized"/i })).not.toBeInTheDocument()
  })

  it('renames a category via the header pencil + popover', async () => {
    seedSkills()
    render(<SkillsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /by category/i }))

    await userEvent.click(screen.getByRole('button', { name: /Rename category "Frontend"/i }))
    const nameInput = screen.getByLabelText(/Category name/i)
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Web Frontend')

    const cats = useStore.getState().data.skill_categories!
    expect(cats.find((c) => c.id === 'frontend')?.name.en).toBe('Web Frontend')
  })
})
