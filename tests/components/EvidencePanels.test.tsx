/**
 * @vitest-environment jsdom
 *
 * The claim–evidence and repetition Overview cards. The behaviour worth
 * pinning: rows navigate to the item they question, a dismissal snoozes via
 * the shared attention machinery, and an empty resume renders neither card.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EvidencePanels } from '../../src/components/editor/EvidencePanels'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeResume, makeProject, makeSkill, makeWork } from '../fixtures'

const SENTENCE = 'Delivered the migration two months early and cut the operating costs by forty percent overall.'

function seed(over: Partial<ReturnType<typeof emptyStore>> = {}) {
  useStore.setState({
    data: { ...emptyStore(), resume: makeResume(), ...over },
    hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'overview', expandedItemId: null, mutationCount: 0,
  })
}

describe('<EvidencePanels>', () => {
  beforeEach(() => resetStore())

  it('renders neither card on an empty resume', () => {
    seed()
    render(<EvidencePanels />)
    expect(screen.queryByText(/claim–evidence check/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/repetition check/i)).not.toBeInTheDocument()
  })

  it('flags an expert rating with no dated usage and navigates to the skill', async () => {
    seed({ skills: [makeSkill({ id: 'sk1', name: { en: 'Kubernetes' }, proficiency: 5 })] })
    render(<EvidencePanels />)

    expect(screen.getByText('Claim–evidence check')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /rated 5\/5/i }))
    expect(useStore.getState().activeSection).toBe('skills')
    expect(useStore.getState().expandedItemId).toBe('sk1')
  })

  it('dismissing a claim snoozes it through attention_dismissals and hides the row', async () => {
    seed({ skills: [makeSkill({ id: 'sk1', name: { en: 'Kubernetes' }, proficiency: 5 })] })
    render(<EvidencePanels />)

    await userEvent.click(screen.getByRole('button', { name: /dismiss the rating finding for Kubernetes/i }))
    const dismissals = useStore.getState().data.resume?.attention_dismissals ?? {}
    expect(Object.keys(dismissals)).toEqual(['claim:proficiency:sk1'])
    expect(screen.queryByRole('button', { name: /rated 5\/5/i })).not.toBeInTheDocument()
  })

  it('shows a repetition pair with both sides clickable, and dismisses it', async () => {
    seed({
      projects: [makeProject({
        id: 'p1', customer: { en: 'Acme' },
        long_description: { en: `<p>${SENTENCE}</p>` },
      })],
      work_experiences: [makeWork({
        id: 'w1', employer: { en: 'BigCo' },
        long_description: { en: `<p>Context first. ${SENTENCE}</p>` },
      })],
    })
    render(<EvidencePanels />)

    expect(screen.getByText('Repetition check')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'BigCo' }))
    expect(useStore.getState().activeSection).toBe('work_experiences')
    expect(useStore.getState().expandedItemId).toBe('w1')

    await userEvent.click(screen.getByRole('button', { name: /dismiss the repetition finding/i }))
    const keys = Object.keys(useStore.getState().data.resume?.attention_dismissals ?? {})
    expect(keys.some((k) => k.startsWith('dup:'))).toBe(true)
    expect(screen.getByText(/don't repeat each other/i)).toBeInTheDocument()
  })
})
