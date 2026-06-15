/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { GlobalSearch } from '../../src/components/GlobalSearch'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeProject, makeSkill } from '../fixtures'

expect.extend(toHaveNoViolations)

function seed() {
  const data = emptyStore()
  data.projects.push(makeProject({ id: 'p1', customer: { en: 'NordicBank' }, long_description: { en: 'Kubernetes platform work' } }))
  data.skills.push(makeSkill({ id: 'k8s', name: { en: 'Kubernetes' } }))
  useStore.setState({
    data, hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'overview', expandedItemId: null, mutationCount: 0,
  })
}

beforeEach(() => resetStore())
afterEach(() => vi.restoreAllMocks())

describe('<GlobalSearch>', () => {
  it('shows results as you type and jumps to the picked item', async () => {
    seed()
    const onClose = vi.fn()
    render(<GlobalSearch onClose={onClose} />)

    await userEvent.type(screen.getByRole('textbox', { name: /search query/i }), 'kubernetes')
    // Both the skill registry and the project match.
    const options = await screen.findAllByRole('option')
    expect(options.length).toBeGreaterThanOrEqual(2)

    // Click the project result.
    const projectOpt = options.find((o) => /NordicBank/.test(o.textContent ?? ''))!
    await userEvent.click(projectOpt)
    expect(useStore.getState().activeSection).toBe('projects')
    expect(useStore.getState().expandedItemId).toBe('p1')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an empty state for a no-match query', async () => {
    seed()
    render(<GlobalSearch onClose={() => {}} />)
    await userEvent.type(screen.getByRole('textbox', { name: /search query/i }), 'zzzznotfound')
    expect(await screen.findByText(/no matches/i)).toBeInTheDocument()
  })

  it('Enter opens the highlighted (first) result', async () => {
    seed()
    render(<GlobalSearch onClose={() => {}} />)
    const input = screen.getByRole('textbox', { name: /search query/i })
    await userEvent.type(input, 'nordicbank{Enter}')
    expect(useStore.getState().activeSection).toBe('projects')
  })

  it('has no accessibility violations', async () => {
    seed()
    const { container } = render(<GlobalSearch onClose={() => {}} />)
    await userEvent.type(screen.getByRole('textbox', { name: /search query/i }), 'kuber')
    await screen.findAllByRole('option')
    expect(await axe(container)).toHaveNoViolations()
  })
})
