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

  it('links a registry role into the project via the autocomplete', async () => {
    const role = makeRole({ name: { en: 'Architect', no: 'Arkitekt' } })
    seedExpandedProject({ roles: [role] })
    render(<ProjectsEditor />)

    const input = screen.getByPlaceholderText(/search or add a role/i)
    await userEvent.click(input)
    await userEvent.click(screen.getByRole('option', { name: /Architect/ }))

    const linked = useStore.getState().data.projects[0].roles[0]
    expect(linked.role_id).toBe(role.id)
    // Snapshot copies BOTH languages from the registry on link.
    expect(linked.name).toEqual({ en: 'Architect', no: 'Arkitekt' })
  })

  it('creates a brand-new registry role via the autocomplete add-new path', async () => {
    seedExpandedProject()
    render(<ProjectsEditor />)

    const input = screen.getByPlaceholderText(/search or add a role/i)
    await userEvent.click(input)
    await userEvent.type(input, 'Tech Lead{Enter}')

    const state = useStore.getState().data
    expect(state.roles).toHaveLength(1)
    expect(state.roles[0].name).toEqual({ en: 'Tech Lead' })
    expect(state.projects[0].roles).toHaveLength(1)
    expect(state.projects[0].roles[0].role_id).toBe(state.roles[0].id)
  })

  it('editing a role chip translation updates the shared registry', async () => {
    const role = makeRole({ name: { en: 'Architect' } })
    // A project already linked to the role so a chip renders.
    const project = makeProject({ customer: { en: 'Acme' } })
    project.roles = [{ id: 'pr1', role_id: role.id, name: role.name, sort_order: 0, disabled: false }]
    useStore.setState({
      data: { ...emptyStore(), roles: [role], projects: [project] },
      hasData: true, primaryLocale: 'en', secondaryLocale: 'no',
      activeSection: 'projects', expandedItemId: project.id, mutationCount: 0,
    })
    render(<ProjectsEditor />)

    // Click the chip to open the dual-language popover, then edit the EN field.
    await userEvent.click(screen.getByRole('button', { name: 'Architect' }))
    const enInput = screen.getByLabelText(/Role name \(English\)/i)
    await userEvent.clear(enInput)
    await userEvent.type(enInput, 'Solution Architect')

    // The registry role itself changed (propagates to every reference).
    expect(useStore.getState().data.roles[0].name.en).toBe('Solution Architect')
  })

  it('links a registry skill into the project via the autocomplete', async () => {
    const skill = makeSkill({ name: { en: 'React' } })
    seedExpandedProject({ skills: [skill] })
    render(<ProjectsEditor />)

    const input = screen.getByPlaceholderText(/search or add a skill/i)
    await userEvent.click(input)
    await userEvent.click(screen.getByRole('option', { name: /React/ }))

    const state = useStore.getState().data
    expect(state.projects[0].skills).toHaveLength(1)
    expect(state.projects[0].skills[0].skill_id).toBe(skill.id)
    // Snapshot name copied from the registry on link.
    expect(state.projects[0].skills[0].name.en).toBe('React')
  })

  it('creates a brand-new registry skill via the autocomplete add-new path', async () => {
    seedExpandedProject()
    render(<ProjectsEditor />)

    const input = screen.getByPlaceholderText(/search or add a skill/i)
    await userEvent.click(input)
    await userEvent.type(input, 'Terraform{Enter}')

    const state = useStore.getState().data
    expect(state.skills).toHaveLength(1)
    expect(state.skills[0].name).toEqual({ en: 'Terraform' })
    // The new skill is linked to the project in one shot.
    expect(state.projects[0].skills).toHaveLength(1)
    expect(state.projects[0].skills[0].skill_id).toBe(state.skills[0].id)
  })
})
