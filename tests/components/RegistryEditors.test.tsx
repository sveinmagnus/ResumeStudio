/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  SkillsEditor, RolesEditor, ReferencesEditor, TechCategoriesEditor,
} from '../../src/components/editor/RegistryEditors'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeSkill, makeProject } from '../fixtures'
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
