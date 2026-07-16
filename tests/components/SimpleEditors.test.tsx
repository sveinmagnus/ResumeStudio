/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import {
  WorkEditor, EducationEditor, CertificationsEditor, PositionsEditor,
  PresentationsEditor, PublicationsEditor, AwardsEditor, SpokenLanguagesEditor,
  ProfileEditor, KeyCompetenciesEditor, RecommendationsEditor,
} from '../../src/components/editor/SimpleEditors'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeWork, makePublication, makeRecommendation } from '../fixtures'
import type { ResumeStore } from '../../src/types'

function seed(data: ResumeStore = emptyStore()) {
  useStore.setState({
    data,
    hasData: true,
    primaryLocale: 'en',
    secondaryLocale: null,
    activeSection: 'overview',
    expandedItemId: null,
    mutationCount: 0,
  })
}

type SectionKey = Exclude<keyof ResumeStore, 'resume'>

const ADD_CASES: { name: string; Comp: ComponentType; section: SectionKey; addLabel: RegExp }[] = [
  { name: 'WorkEditor', Comp: WorkEditor, section: 'work_experiences', addLabel: /add employment/i },
  { name: 'EducationEditor', Comp: EducationEditor, section: 'educations', addLabel: /add education/i },
  { name: 'CertificationsEditor', Comp: CertificationsEditor, section: 'certifications', addLabel: /add certification/i },
  { name: 'PositionsEditor', Comp: PositionsEditor, section: 'positions', addLabel: /add role/i },
  { name: 'PresentationsEditor', Comp: PresentationsEditor, section: 'presentations', addLabel: /add presentation/i },
  { name: 'PublicationsEditor', Comp: PublicationsEditor, section: 'publications', addLabel: /add publication/i },
  { name: 'AwardsEditor', Comp: AwardsEditor, section: 'honor_awards', addLabel: /add award/i },
  { name: 'SpokenLanguagesEditor', Comp: SpokenLanguagesEditor, section: 'spoken_languages', addLabel: /add language/i },
  { name: 'ProfileEditor', Comp: ProfileEditor, section: 'key_qualifications', addLabel: /add profile block/i },
  { name: 'KeyCompetenciesEditor', Comp: KeyCompetenciesEditor, section: 'key_competencies', addLabel: /add competency/i },
]

describe('SimpleEditors — add behaviour', () => {
  beforeEach(() => resetStore())

  for (const { name, Comp, section, addLabel } of ADD_CASES) {
    it(`${name} appends to '${section}', auto-expands, and bumps mutationCount`, async () => {
      seed()
      const before = useStore.getState().mutationCount
      render(<Comp />)
      expect(useStore.getState().data[section]).toHaveLength(0)

      await userEvent.click(screen.getByRole('button', { name: addLabel }))

      const items = useStore.getState().data[section]
      expect(items).toHaveLength(1)
      expect(useStore.getState().expandedItemId).toBe((items[0] as { id: string }).id)
      expect(useStore.getState().mutationCount).toBe(before + 1)
    })
  }
})

describe('SimpleEditors — editing seeded items', () => {
  beforeEach(() => resetStore())

  it('WorkEditor shows an existing employer when the card is expanded', () => {
    const work = makeWork({ employer: { en: 'BigCo' } })
    seed({ ...emptyStore(), work_experiences: [work] })
    useStore.setState({ expandedItemId: work.id })
    render(<WorkEditor />)
    expect(screen.getByDisplayValue('BigCo')).toBeInTheDocument()
  })

  it('PublicationsEditor changes the publication type via the select', async () => {
    const pub = makePublication({ publication_type: 'article' })
    seed({ ...emptyStore(), publications: [pub] })
    useStore.setState({ expandedItemId: pub.id })
    render(<PublicationsEditor />)

    // Two selects render (publication type + DateField month); target the type
    // one by its current selected-option text.
    await userEvent.selectOptions(screen.getByDisplayValue('Article'), 'whitepaper')
    expect(useStore.getState().data.publications[0].publication_type).toBe('whitepaper')
  })
})

describe('ProfileEditor', () => {
  beforeEach(() => resetStore())

  it('adds a new profile block but does NOT expose the legacy per-KQ key_points sub-list', async () => {
    // The per-KQ "Key competency points" sub-list moved to the standalone
    // Key Competencies section (see KeyCompetenciesEditor). Profile blocks
    // now carry only the label / tag line / summary — adding a block must
    // not surface an "Add competency" affordance here.
    seed()
    render(<ProfileEditor />)
    await userEvent.click(screen.getByRole('button', { name: /add profile block/i }))
    expect(useStore.getState().data.key_qualifications).toHaveLength(1)
    expect(useStore.getState().data.key_qualifications[0].key_points).toEqual([])
    expect(screen.queryByRole('button', { name: /add competency/i })).toBeNull()
  })
})

describe('RecommendationsEditor', () => {
  beforeEach(() => resetStore())

  it('shows the relationship in parentheses behind the title and company (collapsed card)', () => {
    const data = emptyStore()
    data.recommendations.push(makeRecommendation({
      recommender_name: 'Jane Doe',
      recommender_title: { en: 'CTO' },
      recommender_company: 'BigCo',
      relationship: { en: 'Was my manager' },
    }))
    seed(data)
    render(<RecommendationsEditor />)
    expect(screen.getByText('CTO, BigCo (Was my manager)')).toBeInTheDocument()
  })

  it('omits the parentheses when no relationship is set', () => {
    const data = emptyStore()
    data.recommendations.push(makeRecommendation({
      recommender_name: 'John Roe', recommender_title: { en: 'CFO' }, recommender_company: 'Acme', relationship: {},
    }))
    seed(data)
    render(<RecommendationsEditor />)
    expect(screen.getByText('CFO, Acme')).toBeInTheDocument()
  })
})
