/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileCompetenciesEditor } from '../../src/components/editor/ProfileCompetenciesEditor'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeResume } from '../fixtures'

function seed() {
  useStore.setState({
    data: { ...emptyStore(), resume: makeResume() },
    hasData: true, activeSection: 'profile_competencies',
    primaryLocale: 'en', secondaryLocale: null,
    expandedItemId: null, mutationCount: 0,
  })
}

describe('<ProfileCompetenciesEditor>', () => {
  beforeEach(() => resetStore())

  it('renders both content sections under their own headings', () => {
    seed()
    render(<ProfileCompetenciesEditor />)
    expect(screen.getByRole('heading', { name: /profile & summary/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /key competencies/i })).toBeInTheDocument()
    // Both sub-editors are live (their add affordances are present).
    expect(screen.getByRole('button', { name: /add profile block/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add competency/i })).toBeInTheDocument()
  })

  it('adds a profile block and a competency from the same page', async () => {
    seed()
    render(<ProfileCompetenciesEditor />)
    await userEvent.click(screen.getByRole('button', { name: /add profile block/i }))
    await userEvent.click(screen.getByRole('button', { name: /add competency/i }))
    expect(useStore.getState().data.key_qualifications).toHaveLength(1)
    expect(useStore.getState().data.key_competencies).toHaveLength(1)
  })
})
