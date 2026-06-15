/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  SkillsEditor, RolesEditor, IndustriesEditor, ReferencesEditor, TechCategoriesEditor,
} from '../../src/components/editor/RegistryEditors'
import { useStore } from '../../src/store/useStore'
import { setSkillRelationsForTest } from '../../src/lib/skillTaxonomy'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeSkill, makeProject, makeIndustry } from '../fixtures'
import type { ResumeStore } from '../../src/types'

function seed(data: ResumeStore = emptyStore()) {
  useStore.setState({
    data, hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'skills', expandedItemId: null, mutationCount: 0,
  })
}

afterEach(() => vi.restoreAllMocks())

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
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<SkillsEditor />)
    await userEvent.selectOptions(
      screen.getByDisplayValue('— pick a target —'),
      screen.getByRole('option', { name: 'React' }),
    )

    expect(confirmSpy).toHaveBeenCalled()
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
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<SkillsEditor />)
    await userEvent.selectOptions(
      screen.getByDisplayValue('— pick a target —'),
      screen.getByRole('option', { name: 'React' }),
    )
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

describe('<TechCategoriesEditor>', () => {
  beforeEach(() => resetStore())

  it('adds a category and links a registry skill via the autocomplete', async () => {
    const skill = makeSkill({ name: { en: 'React' } })
    seed({ ...emptyStore(), skills: [skill] })
    render(<TechCategoriesEditor />)

    await userEvent.click(screen.getByRole('button', { name: /add category/i }))
    const catId = useStore.getState().data.technology_categories[0].id
    useStore.setState({ expandedItemId: catId })

    // The Autocomplete renders a textbox; clicking a result row links the skill.
    const input = screen.getByPlaceholderText(/search or add a skill/i)
    await userEvent.click(input)
    await userEvent.click(screen.getByRole('option', { name: /React/ }))
    expect(useStore.getState().data.technology_categories[0].skills).toHaveLength(1)
    expect(useStore.getState().data.technology_categories[0].skills[0].skill_id).toBe(skill.id)
  })

  it('creates a brand-new registry skill when the typed name has no match', async () => {
    seed()
    render(<TechCategoriesEditor />)
    await userEvent.click(screen.getByRole('button', { name: /add category/i }))
    const catId = useStore.getState().data.technology_categories[0].id
    useStore.setState({ expandedItemId: catId })

    const input = screen.getByPlaceholderText(/search or add a skill/i)
    await userEvent.click(input)
    await userEvent.type(input, 'Kubernetes{Enter}')

    const state = useStore.getState().data
    expect(state.skills).toHaveLength(1)
    expect(state.skills[0].name).toEqual({ en: 'Kubernetes' })
    expect(state.technology_categories[0].skills).toHaveLength(1)
    expect(state.technology_categories[0].skills[0].skill_id).toBe(state.skills[0].id)
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
    const project = makeProject({ id: 'p', industry_id: 'a', industry: { en: 'finance' } })
    seedInd({ ...emptyStore(), industries: [a, b], projects: [project] })
    useStore.setState({ expandedItemId: 'a' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<IndustriesEditor />)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /merge this industry/i }),
      screen.getByRole('option', { name: 'Finance' }),
    )

    const industries = useStore.getState().data.industries
    expect(industries).toHaveLength(1)         // source removed
    expect(industries[0].id).toBe('b')
    expect(useStore.getState().data.projects[0].industry_id).toBe('b') // ref rewritten
  })
})
