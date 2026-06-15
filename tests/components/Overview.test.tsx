/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Overview } from '../../src/components/editor/Overview'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { makeResume, makeProject, makeCertification, emptyStore } from '../fixtures'

function seedTwoLocaleResume() {
  // English fully filled, Norwegian missing the project's customer field.
  useStore.setState({
    data: {
      resume: makeResume({
        supported_locales: ['en', 'no'],
        title: { en: 'Consultant', no: 'Konsulent' },
        nationality: { en: 'Norwegian', no: 'Norsk' },
        place_of_residence: { en: 'Oslo', no: 'Oslo' },
      }),
      skills: [], roles: [], key_qualifications: [], key_competencies: [], recommendations: [],
      projects: [makeProject({
        id: 'p1',
        customer: { en: 'Acme' },                              // missing 'no'
        description: { en: 'desc', no: 'beskrivelse' },
        long_description: { en: 'long', no: 'lang' },
      })],
      work_experiences: [], educations: [], courses: [], certifications: [],
      spoken_languages: [], technology_categories: [], positions: [],
      presentations: [], honor_awards: [], publications: [], references: [],
      views: [],
    },
    hasData: true,
    primaryLocale: 'en',
    secondaryLocale: 'no',
    activeSection: 'overview',
    expandedItemId: null,
  })
}

describe('<Overview> needs-attention panel (F3)', () => {
  beforeEach(() => resetStore())

  it('shows nothing when there is no stale or expiring content', () => {
    useStore.setState({
      data: { ...emptyStore(), resume: makeResume() },
      hasData: true, primaryLocale: 'en', secondaryLocale: null,
      activeSection: 'overview', expandedItemId: null,
    })
    render(<Overview />)
    expect(screen.queryByRole('region', { name: /needs attention/i })).not.toBeInTheDocument()
  })

  it('lists an expired certification and jumps to it on click', async () => {
    useStore.setState({
      data: {
        ...emptyStore(),
        resume: makeResume(),
        certifications: [makeCertification({
          id: 'c1', name: { en: 'AWS SA' }, expires: { year: 2000, month: 1 }, // long expired
        })],
      },
      hasData: true, primaryLocale: 'en', secondaryLocale: null,
      activeSection: 'overview', expandedItemId: null,
    })
    render(<Overview />)
    expect(screen.getByRole('region', { name: /needs attention/i })).toBeInTheDocument()
    expect(screen.getByText('AWS SA')).toBeInTheDocument()
    expect(screen.getByText('Expired')).toBeInTheDocument()

    await userEvent.click(screen.getByText('AWS SA'))
    expect(useStore.getState().activeSection).toBe('certifications')
    expect(useStore.getState().expandedItemId).toBe('c1')
  })
})

describe('<Overview> translation completeness drill-down', () => {
  beforeEach(() => resetStore())

  it('disables the row for a locale with no missing fields', () => {
    seedTwoLocaleResume()
    render(<Overview />)
    const enRow = screen.getByRole('button', { name: /English/ })
    expect(enRow).toBeDisabled()
    expect(enRow).toHaveAttribute('aria-expanded', 'false')
  })

  it('expands the missing-field list when the locale row is clicked', async () => {
    seedTwoLocaleResume()
    render(<Overview />)
    const noRow = screen.getByRole('button', { name: /Norsk/ })
    expect(noRow).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(noRow)
    expect(noRow).toHaveAttribute('aria-expanded', 'true')
    // Missing in 'no': project customer. Scope to the missing-field list — the
    // career-timeline card also labels a bar "Acme" (the same project).
    const list = await screen.findByRole('list')
    expect(list).toBeInTheDocument()
    expect(within(list).getByText('Acme')).toBeInTheDocument()
    expect(within(list).getByText('Customer')).toBeInTheDocument()
  })

  it('navigates to the editor section and expands the item when a missing row is clicked', async () => {
    seedTwoLocaleResume()
    render(<Overview />)
    await userEvent.click(screen.getByRole('button', { name: /Norsk/ }))
    // The missing-row button label concatenates item + ' · ' + field.
    const missingBtn = screen.getByRole('button', { name: /Acme.*Customer/ })
    await userEvent.click(missingBtn)
    const { activeSection, expandedItemId } = useStore.getState()
    expect(activeSection).toBe('projects')
    expect(expandedItemId).toBe('p1')
  })

  it('toggles closed on a second click', async () => {
    seedTwoLocaleResume()
    render(<Overview />)
    const noRow = screen.getByRole('button', { name: /Norsk/ })
    await userEvent.click(noRow)
    expect(noRow).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(noRow)
    expect(noRow).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})
