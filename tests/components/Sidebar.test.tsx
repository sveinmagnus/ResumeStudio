/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '../../src/components/layout/Sidebar'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeProject } from '../fixtures'

function seed() {
  useStore.setState({
    data: { ...emptyStore(), projects: [makeProject(), makeProject()] },
    hasData: true, activeSection: 'overview', expandedItemId: null, mutationCount: 0,
  })
}

describe('<Sidebar>', () => {
  beforeEach(() => resetStore())

  it('renders section groups and a per-section count', () => {
    seed()
    render(<Sidebar />)
    // Projects button shows the count badge (2 seeded).
    expect(screen.getByRole('button', { name: /Projects\s*2/ })).toBeInTheDocument()
  })

  it('renders the Export group first (Resume Views at the top of the nav)', () => {
    seed()
    render(<Sidebar />)
    const labels = Array.from(document.querySelectorAll('.sb-group-label')).map((el) => el.textContent)
    expect(labels[0]).toBe('Export')
    // The first nav item inside the first group is Resume Views.
    const firstGroup = document.querySelector('.sb-group')
    expect(firstGroup?.textContent).toContain('Resume Views')
  })

  it('navigates on click', async () => {
    seed()
    render(<Sidebar />)
    await userEvent.click(screen.getByRole('button', { name: /^Projects/ }))
    expect(useStore.getState().activeSection).toBe('projects')
  })

  it('shows the resume owner name in the brand block', () => {
    useStore.setState({
      data: { ...emptyStore() },
      hasData: true, activeSection: 'overview', expandedItemId: null, mutationCount: 0,
    })
    render(<Sidebar />)
    expect(screen.getByText('Test Person')).toBeInTheDocument()
  })
})
