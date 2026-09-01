/**
 * @vitest-environment jsdom
 *
 * The toast → section-gaps handoff. The reported bug: run "What's missing?"
 * in a section, navigate away, click the finished toast's "Show me" — it
 * navigated to the section and showed NOTHING, because the results live behind
 * the section bar's modal and nothing opened it. "Show me" promises the
 * response on screen, so the toast now leaves a one-shot reveal the button
 * consumes by opening its modal.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdvisorToast } from '../../src/components/ui/AdvisorToast'
import { SectionAdviceButton } from '../../src/components/ui/SectionAdviceButton'
import { useStore } from '../../src/store/useStore'
import { useAdvisors, REVEAL_FRESH_MS, fieldScope } from '../../src/store/useAdvisors'
import { resetStore } from '../helpers/store-reset'
import { resetLlmAvailability } from '../../src/lib/llmClient'
import { api } from '../../src/lib/api'
import { emptyStore, makeCourse } from '../fixtures'

const RESUME = 'resume-1'

function seed() {
  useStore.setState({
    currentResumeId: RESUME,
    data: { ...emptyStore(), courses: [makeCourse({ id: 'c1', name: { en: 'K8s Fundamentals' } })] },
    hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'overview',
  })
  resetLlmAvailability()
  vi.spyOn(api, 'llmStatus').mockResolvedValue({
    configured: true, provider: 'anthropic', model: 'claude-opus-4-5', local: false, highEnd: true,
  })
}

async function seedFinishedRun() {
  await useAdvisors.getState().start(
    { id: 'section', resumeId: RESUME, scope: 'courses' },
    async () => '{"findings":[]}',
  )
}

beforeEach(() => {
  resetStore()
  localStorage.clear()
  useAdvisors.setState({ runs: {}, reveal: null })
  seed()
})
afterEach(() => vi.restoreAllMocks())

describe('the toast’s "Show me" ends with the response on screen', () => {
  it('opens the section-gaps modal, showing the run’s result', async () => {
    await seedFinishedRun()
    const user = userEvent.setup()
    // The button is what the section bar mounts once navigation lands there —
    // both in one tree, as in the app.
    render(<><AdvisorToast /><SectionAdviceButton section="courses" /></>)

    await user.click(await screen.findByRole('button', { name: /show me/i }))

    // Navigation went to the section the run examined…
    expect(useStore.getState().activeSection).toBe('courses')
    // …and the modal opened, with the parsed result visible (empty findings
    // render as the section-complete line).
    await screen.findByRole('dialog', { name: /what.s missing from courses/i })
    expect(await screen.findByText(/courses looks complete/i)).toBeInTheDocument()
    // One-shot: nothing left to re-open a modal later.
    expect(useAdvisors.getState().reveal).toBeNull()
  })

  it('opens even when the user is ALREADY standing in the section', async () => {
    await seedFinishedRun()
    useStore.setState({ activeSection: 'courses' })
    const user = userEvent.setup()
    render(<><AdvisorToast /><SectionAdviceButton section="courses" /></>)

    await user.click(await screen.findByRole('button', { name: /show me/i }))
    expect(await screen.findByRole('dialog', { name: /what.s missing from courses/i })).toBeInTheDocument()
  })

  it('a reveal for ANOTHER section does not open this one’s modal', async () => {
    await seedFinishedRun()
    useAdvisors.getState().requestReveal({ id: 'section', resumeId: RESUME, scope: 'projects' })
    render(<SectionAdviceButton section="courses" />)

    await screen.findByRole('button', { name: /what.s missing/i })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Left for the surface it names — courses must not consume projects' click.
    expect(useAdvisors.getState().reveal).toMatchObject({ scope: 'projects' })
  })

  it('an orphaned stale reveal is swept, never popped as a ghost modal', async () => {
    await seedFinishedRun()
    useAdvisors.setState({
      reveal: { id: 'section', resumeId: RESUME, scope: 'courses', at: Date.now() - REVEAL_FRESH_MS - 1 },
    })
    render(<SectionAdviceButton section="courses" />)

    await screen.findByRole('button', { name: /what.s missing/i })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useAdvisors.getState().reveal).toBeNull()
  })
})

describe('view-scoped runs land IN the view, not on the list', () => {
  it('"Show me" on a finished intro draft opens that view’s editor', async () => {
    await useAdvisors.getState().start(
      { id: 'intro', resumeId: RESUME, scope: 'view-9' },
      async () => 'A drafted introduction.',
    )
    const user = userEvent.setup()
    render(<AdvisorToast />)

    await user.click(await screen.findByRole('button', { name: /show me/i }))

    // setActiveView both switches the section and selects the view — landing
    // on the views LIST would show nothing of the draft.
    expect(useStore.getState().activeSection).toBe('views')
    expect(useStore.getState().activeViewId).toBe('view-9')
  })
})

describe('field-scoped runs land IN the item, not on the list', () => {
  it('"Show me" on a finished rewrite opens that item’s card', async () => {
    await useAdvisors.getState().start(
      { id: 'write', resumeId: RESUME, scope: fieldScope('projects', 'p-7') },
      async () => '{"rewrite":"Led the migration."}',
    )
    const user = userEvent.setup()
    render(<AdvisorToast />)

    await user.click(await screen.findByRole('button', { name: /show me/i }))

    // The card has to be OPENED, not merely navigated to: EditorCard renders
    // its body only while expanded, and setActiveSection has just collapsed
    // everything — so a section-only jump lands on a list showing nothing.
    expect(useStore.getState().activeSection).toBe('projects')
    expect(useStore.getState().expandedItemId).toBe('p-7')
  })
})
