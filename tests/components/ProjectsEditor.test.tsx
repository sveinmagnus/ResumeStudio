/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectsEditor } from '../../src/components/editor/ProjectsEditor'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeProject, makeRole, makeSkill } from '../fixtures'
import type { ResumeStore } from '../../src/types'

function seed(data: ResumeStore = emptyStore()) {
  useStore.setState({
    data, hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'projects', expandedItemId: null, mutationCount: 0,
  })
}

/** Seed one expanded project so its sub-editors are visible. */
function seedExpandedProject(over: Partial<ResumeStore> = {}) {
  const project = makeProject({ customer: { en: 'Acme' }, start: null, end: null })
  seed({ ...emptyStore(), projects: [project], ...over })
  useStore.setState({ expandedItemId: project.id })
  return project
}

describe('<ProjectsEditor>', () => {
  beforeEach(() => resetStore())

  it('adds a project and auto-expands it', async () => {
    seed()
    render(<ProjectsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /add project/i }))
    const projects = useStore.getState().data.projects
    expect(projects).toHaveLength(1)
    expect(useStore.getState().expandedItemId).toBe(projects[0].id)
  })

  it('adds, edits, and removes a highlight bullet', async () => {
    const project = seedExpandedProject()
    render(<ProjectsEditor />)

    await userEvent.click(screen.getByRole('button', { name: /add highlight/i }))
    expect(useStore.getState().data.projects[0].highlights).toHaveLength(1)

    await userEvent.type(screen.getByPlaceholderText('Achievement…'), 'Cut latency 40%')
    expect(useStore.getState().data.projects[0].highlights[0].en).toBe('Cut latency 40%')

    // The highlight delete button is the only one rendered before "Add highlight".
    const delButtons = screen.getAllByRole('button')
    const del = delButtons.find((b) => b.className.includes('hl-del'))!
    await userEvent.click(del)
    expect(useStore.getState().data.projects[0].highlights).toHaveLength(0)
    void project
  })

  it('adds a project role and links it to a registry role', async () => {
    const role = makeRole({ name: { en: 'Architect' } })
    const project = seedExpandedProject({ roles: [role] })
    render(<ProjectsEditor />)

    await userEvent.click(screen.getByRole('button', { name: /add role/i }))
    expect(useStore.getState().data.projects[0].roles).toHaveLength(1)

    // Link via the role <select> (its default option text is unique).
    const roleSelect = screen.getByDisplayValue('— link to registry role —')
    await userEvent.selectOptions(roleSelect, screen.getByRole('option', { name: 'Architect' }))

    const linked = useStore.getState().data.projects[0].roles[0]
    expect(linked.role_id).toBe(role.id)
    expect(linked.name.en).toBe('Architect') // snapshot copied from the registry
    void project
  })

  it('adds a project skill chip and links it to a registry skill', async () => {
    const skill = makeSkill({ name: { en: 'React' } })
    seedExpandedProject({ skills: [skill] })
    render(<ProjectsEditor />)

    await userEvent.click(screen.getByRole('button', { name: /add skill/i }))
    expect(useStore.getState().data.projects[0].skills).toHaveLength(1)

    await userEvent.selectOptions(
      screen.getByDisplayValue('— select skill —'),
      screen.getByRole('option', { name: 'React' }),
    )
    expect(useStore.getState().data.projects[0].skills[0].skill_id).toBe(skill.id)
  })
})
