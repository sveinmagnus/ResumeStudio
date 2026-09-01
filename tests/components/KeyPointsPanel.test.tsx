/**
 * @vitest-environment jsdom
 *
 * "Suggest highlights", driven through the real Projects editor (where it
 * lives, beside Add highlight).
 *
 * The contract worth pinning is the one the panel was rewritten for: the run
 * belongs to the advisor store, not to the card. Collapsing the card — which is
 * what clicking any other project does — unmounts this panel, and both an
 * in-flight request and an un-actioned list have to survive that.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectsEditor } from '../../src/components/editor/ProjectsEditor'
import { useStore } from '../../src/store/useStore'
import { useAdvisors } from '../../src/store/useAdvisors'
import { resetStore } from '../helpers/store-reset'
import { resetLlmAvailability } from '../../src/lib/llmClient'
import { resetAssistConsent } from '../../src/components/ui/AssistRun'
import { api } from '../../src/lib/api'
import { emptyStore, makeProject, makeResume } from '../fixtures'

const LOCAL = { configured: true, provider: 'ollama', model: 'llama3.2:3b', local: true, highEnd: false }

function seed() {
  resetLlmAvailability()
  resetAssistConsent()
  vi.spyOn(api, 'llmStatus').mockResolvedValue(LOCAL)
  useStore.setState({
    data: {
      ...emptyStore(),
      resume: makeResume(),
      projects: [makeProject({
        id: 'p1',
        customer: { en: 'Acme' },
        long_description: { en: '<p>Migrated twelve services and mentored two juniors.</p>' },
      })],
    },
    hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'projects', expandedItemId: 'p1', mutationCount: 0,
    currentResumeId: 'resume-1',
  })
}

function reply(bodies: string[]) {
  vi.spyOn(api, 'llmComplete').mockResolvedValue(
    JSON.stringify({ $schema: 'resumestudio-points/v1', points: bodies.map((body) => ({ body })) }),
  )
}

/**
 * Collapse the card and open it again — what clicking another project does.
 *
 * The middle assertion is load-bearing: without proof that the panel really
 * left the DOM, React batching the two updates into one render would make
 * every test below pass against the very bug they exist to catch.
 */
async function revisit() {
  useStore.setState({ expandedItemId: null })
  await waitFor(() => expect(screen.queryByRole('button', { name: /suggest highlights/i })).not.toBeInTheDocument())
  useStore.setState({ expandedItemId: 'p1' })
}

const project = () => useStore.getState().data.projects[0]
const suggest = () => screen.findByRole('button', { name: /suggest highlights/i })
const box = (text: string) => screen.getAllByRole('checkbox')
  .find((b) => b.closest('label')?.textContent?.includes(text)) as HTMLInputElement

describe('<KeyPointsPanel>', () => {
  beforeEach(() => {
    resetStore()
    vi.restoreAllMocks()
    localStorage.clear()
    useAdvisors.setState({ runs: {}, reveal: null })
  })

  it('adds only the ticked points, and every point starts ticked', async () => {
    seed()
    reply(['Migrated twelve services.', 'Mentored two juniors.'])
    render(<ProjectsEditor />)

    await userEvent.click(await suggest())
    await screen.findByText('Migrated twelve services.')
    // A bullet on one item is local and trivially undone, so all start ticked.
    expect(box('Migrated').checked).toBe(true)
    expect(box('Mentored').checked).toBe(true)

    await userEvent.click(box('Mentored'))
    await userEvent.click(screen.getByRole('button', { name: /add 1$/i }))

    await waitFor(() => expect(project().highlights).toHaveLength(1))
    expect(project().highlights[0].en).toBe('Migrated twelve services.')
  })

  it('is still working when the card is collapsed and reopened', async () => {
    seed()
    let settle: (r: string) => void = () => {}
    vi.spyOn(api, 'llmComplete').mockReturnValue(new Promise<string>((res) => { settle = res }))
    render(<ProjectsEditor />)

    await userEvent.click(await suggest())
    expect(await screen.findByRole('button', { name: /working/i })).toBeInTheDocument()

    await revisit()
    expect(await screen.findByRole('button', { name: /working/i })).toBeInTheDocument()

    // The reply lands in a panel that was unmounted when it was asked for.
    settle(JSON.stringify({ points: [{ body: 'Migrated twelve services.' }] }))
    expect(await screen.findByText('Migrated twelve services.')).toBeInTheDocument()
  })

  it('keeps an un-actioned list, and its ticks, across a collapse', async () => {
    seed()
    reply(['Migrated twelve services.', 'Mentored two juniors.'])
    render(<ProjectsEditor />)

    await userEvent.click(await suggest())
    await screen.findByText('Migrated twelve services.')
    await userEvent.click(box('Mentored'))

    await revisit()

    await screen.findByText('Migrated twelve services.')
    expect(box('Migrated').checked).toBe(true)
    // Coming back to find a carefully-unticked point re-ticked is the same
    // loss the run store exists to prevent, one size down.
    expect(box('Mentored').checked).toBe(false)
    expect(project().highlights).toHaveLength(0)
  })

  it('is gone for good once discarded', async () => {
    seed()
    reply(['Migrated twelve services.'])
    render(<ProjectsEditor />)

    await userEvent.click(await suggest())
    await userEvent.click(await screen.findByRole('button', { name: /discard/i }))

    await revisit()
    await suggest()
    expect(screen.queryByText('Migrated twelve services.')).not.toBeInTheDocument()
    expect(project().highlights).toHaveLength(0)
  })

  it('reports an unreadable reply instead of adding junk', async () => {
    seed()
    vi.spyOn(api, 'llmComplete').mockResolvedValue('I cannot help with that.')
    render(<ProjectsEditor />)

    await userEvent.click(await suggest())
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(project().highlights).toHaveLength(0)
  })

  it('is disabled with no description to reshape', async () => {
    seed()
    useStore.setState({
      data: {
        ...useStore.getState().data,
        projects: [makeProject({ id: 'p1', customer: { en: 'Acme' }, long_description: {} })],
      },
    })
    render(<ProjectsEditor />)
    expect(await suggest()).toBeDisabled()
  })
})
