/**
 * @vitest-environment jsdom
 *
 * The debrief interview modal. Driven through the BYO manual path (no model
 * configured — the manual steps are then the only, and open, path), which
 * exercises the same validate → review → apply pipeline the Run button feeds.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DebriefModal } from '../../src/components/editor/DebriefModal'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { resetLlmAvailability } from '../../src/lib/llmClient'
import { api, ASSIST_OFF } from '../../src/lib/api'
import { DEBRIEF_SCHEMA } from '../../src/lib/debrief'
import { emptyStore, makeResume, makeProject, makeSkill } from '../fixtures'

function seed() {
  resetLlmAvailability()
  vi.spyOn(api, 'llmStatus').mockResolvedValue(ASSIST_OFF)
  useStore.setState({
    data: {
      ...emptyStore(),
      resume: makeResume(),
      skills: [makeSkill({ id: 's-react', name: { en: 'React' } })],
      projects: [makeProject({
        id: 'p1', customer: { en: 'Acme' }, highlights: [], skills: [],
        end: { year: 2026, month: 5 },
      })],
    },
    hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'projects', expandedItemId: null, mutationCount: 0,
  })
}

const project = () => useStore.getState().data.projects[0]

const REPLY = JSON.stringify({
  $schema: DEBRIEF_SCHEMA,
  highlights: ['Cut operating costs 40%'],
  skills: ['React', 'Terraform'],
  short_description: 'Modernised the Acme platform.',
})

async function pasteReply(reply: string) {
  await userEvent.type(
    screen.getByLabelText(/what changed for the customer/i),
    'Cut operating costs 40% using React and Terraform.',
  )
  await userEvent.click(screen.getByLabelText('Paste the AI reply'))
  await userEvent.paste(reply)
  await userEvent.click(screen.getByRole('button', { name: /use reply/i }))
}

describe('<DebriefModal>', () => {
  beforeEach(() => { resetStore(); vi.restoreAllMocks() })

  it('asks the structural questions for what the project lacks', async () => {
    seed()
    render(<DebriefModal project={project()} onClose={() => {}} />)
    expect(screen.getByText(/what changed for the customer/i)).toBeInTheDocument()
    expect(screen.getByText(/hardest problem/i)).toBeInTheDocument()
    // < 3 highlights → the highlights question appears.
    expect(screen.getByText(/worth a bullet of their own/i)).toBeInTheDocument()
    // No model → the manual path is open by default.
    expect(await screen.findByLabelText('Paste the AI reply')).toBeInTheDocument()
  })

  it('reviews a pasted reply and applies only the ticked changes as one batch', async () => {
    seed()
    const onClose = vi.fn()
    render(<DebriefModal project={project()} onClose={onClose} />)
    await pasteReply(REPLY)

    // Existing registry skill pre-ticked; the novel one is a deliberate click.
    expect(screen.getByText('Cut operating costs 40%')).toBeInTheDocument()
    expect(screen.getByText('in registry')).toBeInTheDocument()
    expect(screen.getByText('new registry skill')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /terraform/i }))
    await userEvent.click(screen.getByRole('button', { name: /apply 4 changes/i }))

    const p = project()
    expect(p.highlights.map((h) => h.en)).toEqual(['Cut operating costs 40%'])
    expect(p.short_description?.en).toBe('Modernised the Acme platform.')
    expect(p.debriefed_at).toBeTruthy()
    const names = useStore.getState().data.skills.map((s) => s.name.en)
    expect(names).toContain('Terraform')
    expect(p.skills).toHaveLength(2)
    // One replaceData batch = one undo step.
    expect(useStore.getState().mutationCount).toBe(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('never overwrites an existing short description without an explicit tick', async () => {
    seed()
    useStore.setState((s) => ({
      data: {
        ...s.data,
        projects: [{ ...s.data.projects[0], short_description: { en: 'Hand-written line' } }],
      },
    }))
    render(<DebriefModal project={project()} onClose={() => {}} />)
    await pasteReply(REPLY)

    expect(screen.getByText('replaces the current line')).toBeInTheDocument()
    // Unticked by default → applying the rest leaves the line alone.
    await userEvent.click(screen.getByRole('button', { name: /apply 2 changes/i }))
    expect(project().short_description?.en).toBe('Hand-written line')
  })

  it('rejects an unusable reply with an error instead of a review list', async () => {
    seed()
    render(<DebriefModal project={project()} onClose={() => {}} />)
    await pasteReply('{"highlights": []}')
    expect(screen.getByRole('alert')).toHaveTextContent(/no highlights, skills or short description/i)
  })

  it('"nothing new" stamps debriefed_at without touching content', async () => {
    seed()
    const onClose = vi.fn()
    render(<DebriefModal project={project()} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /nothing new — mark as debriefed/i }))
    expect(project().debriefed_at).toBeTruthy()
    expect(project().highlights).toEqual([])
    expect(onClose).toHaveBeenCalled()
  })
})
