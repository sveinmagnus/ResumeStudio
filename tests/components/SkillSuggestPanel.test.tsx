/**
 * @vitest-environment jsdom
 *
 * Skill suggestions, driven through the real Projects editor. The promise worth
 * pinning is the no-duplicate one: a suggestion that matches the registry must
 * LINK the existing skill, never grow a near-copy of it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectsEditor } from '../../src/components/editor/ProjectsEditor'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { resetSummarizeAvailability } from '../../src/lib/summarizeClient'
import { resetAssistConsent } from '../../src/components/ui/AssistRun'
import { api } from '../../src/lib/api'
import { emptyStore, makeProject, makeSkill, makeResume } from '../fixtures'

const LOCAL = { configured: true, provider: 'ollama', model: 'llama3.2:3b', local: true }

function seed() {
  resetSummarizeAvailability()
  resetAssistConsent()
  vi.spyOn(api, 'summarizeStatus').mockResolvedValue(LOCAL)
  useStore.setState({
    data: {
      ...emptyStore(),
      resume: makeResume(),
      skills: [makeSkill({ id: 's-react', name: { en: 'React' } })],
      projects: [makeProject({
        id: 'p1',
        customer: { en: 'Acme' },
        long_description: { en: '<p>Built a React front end with Rust services.</p>' },
      })],
    },
    hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'projects', expandedItemId: 'p1', mutationCount: 0,
  })
}

/** The model replies (fenced, as they do) with one known + one novel skill. */
function reply(skills: string[]) {
  vi.spyOn(api, 'llmComplete').mockResolvedValue(
    '```json\n' + JSON.stringify({ $schema: 'resumestudio-skills/v1', skills }) + '\n```',
  )
}

const project = () => useStore.getState().data.projects[0]
const registry = () => useStore.getState().data.skills

describe('<SkillSuggestPanel>', () => {
  beforeEach(() => { resetStore(); vi.restoreAllMocks() })

  it('links an existing registry skill instead of creating a duplicate', async () => {
    seed()
    // The model says "React.js"; the registry says "React".
    reply(['React.js'])
    render(<ProjectsEditor />)

    await userEvent.click(await screen.findByRole('button', { name: /suggest skills/i }))
    await screen.findByText(/in registry/i)
    await userEvent.click(screen.getByRole('button', { name: /add 1 skill/i }))

    await waitFor(() => expect(project().skills).toHaveLength(1))
    // Linked the EXISTING skill…
    expect(project().skills[0].skill_id).toBe('s-react')
    // …and did not grow the registry.
    expect(registry()).toHaveLength(1)
  })

  it('pre-ticks registry matches but not new registry entries', async () => {
    seed()
    reply(['React', 'Rust'])
    render(<ProjectsEditor />)
    await userEvent.click(await screen.findByRole('button', { name: /suggest skills/i }))

    const boxes = await screen.findAllByRole('checkbox')
    const byName = (n: string) => boxes.find((b) => b.closest('label')?.textContent?.includes(n)) as HTMLInputElement
    // Linking an existing skill is cheap; growing the shared registry isn't.
    expect(byName('React').checked).toBe(true)
    expect(byName('Rust').checked).toBe(false)
    expect(screen.getByRole('button', { name: /add 1 skill/i })).toBeInTheDocument()
  })

  it('creates a registry entry only when the user ticks the novel one', async () => {
    seed()
    reply(['Rust'])
    render(<ProjectsEditor />)
    await userEvent.click(await screen.findByRole('button', { name: /suggest skills/i }))

    // The novel entry starts unticked — tick it deliberately.
    const box = await screen.findByRole('checkbox')
    expect(box).not.toBeChecked()
    await userEvent.click(box)
    await userEvent.click(screen.getByRole('button', { name: /add 1 skill/i }))

    await waitFor(() => expect(registry()).toHaveLength(2))
    expect(registry().some((s) => s.name.en === 'Rust')).toBe(true)
    expect(project().skills).toHaveLength(1)
  })

  it('writes nothing when the suggestions are discarded', async () => {
    seed()
    reply(['React', 'Rust'])
    render(<ProjectsEditor />)
    await userEvent.click(await screen.findByRole('button', { name: /suggest skills/i }))
    await userEvent.click(await screen.findByRole('button', { name: /discard/i }))

    expect(project().skills).toHaveLength(0)
    expect(registry()).toHaveLength(1)
  })

  it('reports an unreadable reply instead of writing junk', async () => {
    seed()
    vi.spyOn(api, 'llmComplete').mockResolvedValue('I cannot help with that.')
    render(<ProjectsEditor />)
    await userEvent.click(await screen.findByRole('button', { name: /suggest skills/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(project().skills).toHaveLength(0)
  })

  it('is disabled with nothing to read', async () => {
    seed()
    useStore.setState({
      data: {
        ...useStore.getState().data,
        projects: [makeProject({ id: 'p1', customer: { en: 'Acme' }, description: {}, long_description: {} })],
      },
    })
    render(<ProjectsEditor />)
    expect(await screen.findByRole('button', { name: /suggest skills/i })).toBeDisabled()
  })
})
