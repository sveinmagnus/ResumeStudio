/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import {
  WorkEditor, EducationEditor, CertificationsEditor, PositionsEditor,
  PresentationsEditor, PublicationsEditor, AwardsEditor, SpokenLanguagesEditor,
  ProfileEditor, KeyCompetenciesEditor, RecommendationsEditor,
} from '../../src/components/editor/SimpleEditors'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeWork, makePresentation, makePublication, makeRecommendation, makeKQ, makeKeyCompetency } from '../fixtures'
import { COURSE_CATEGORIES } from '../../src/lib/courseCategories'
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
  { name: 'ProfileEditor', Comp: ProfileEditor, section: 'key_qualifications', addLabel: /add profile/i },
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

      const items = useStore.getState().data[section] as Array<{ id: string }>
      expect(items).toHaveLength(1)
      expect(useStore.getState().expandedItemId).toBe(items[0].id)
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

  it('PublicationsEditor sets the editor-only category without touching the type', async () => {
    const pub = makePublication({ publication_type: 'article' })
    seed({ ...emptyStore(), publications: [pub] })
    useStore.setState({ expandedItemId: pub.id })
    render(<PublicationsEditor />)

    await userEvent.selectOptions(screen.getByLabelText('Category'), 'medical')
    const saved = useStore.getState().data.publications[0]
    expect(saved.category).toBe('medical')
    // The two are orthogonal: one is exported, the other is not.
    expect(saved.publication_type).toBe('article')
  })

  it('PresentationsEditor sets the editor-only category', async () => {
    const talk = makePresentation()
    seed({ ...emptyStore(), presentations: [talk] })
    useStore.setState({ expandedItemId: talk.id })
    render(<PresentationsEditor />)

    await userEvent.selectOptions(screen.getByLabelText('Category'), 'sales')
    expect(useStore.getState().data.presentations[0].category).toBe('sales')
  })

  it('offers Presentations and Publications the same vocabulary as Courses', () => {
    // One vocabulary across the four sections — a second copy would drift.
    const labels = (): string[] =>
      [...screen.getByLabelText('Category').querySelectorAll('option')]
        .map((o) => o.textContent ?? '').filter((t) => t !== '—')

    const talk = makePresentation()
    seed({ ...emptyStore(), presentations: [talk] })
    useStore.setState({ expandedItemId: talk.id })
    const { unmount } = render(<PresentationsEditor />)
    const fromTalk = labels()
    unmount()

    const pub = makePublication()
    seed({ ...emptyStore(), publications: [pub] })
    useStore.setState({ expandedItemId: pub.id })
    render(<PublicationsEditor />)

    expect(fromTalk).toEqual(COURSE_CATEGORIES.map((c) => c.label))
    expect(labels()).toEqual(fromTalk)
  })
})

describe('ProfileEditor', () => {
  beforeEach(() => resetStore())

  it('adds a new profile block with an empty competency bundle (no legacy key_points sub-list)', async () => {
    // The legacy per-KQ `key_points` array stays gone; a profile now owns an
    // ordered competency BUNDLE (shape v12) instead — `competency_ids`.
    seed()
    render(<ProfileEditor />)
    await userEvent.click(screen.getByRole('button', { name: /add profile/i }))
    const kqs = useStore.getState().data.key_qualifications
    expect(kqs).toHaveLength(1)
    expect(kqs[0].key_points).toEqual([])
    expect(kqs[0].competency_ids).toEqual([])
  })

  it('adds a competency to the profile bundle via the card affordance', async () => {
    seed()
    render(<ProfileEditor />)
    await userEvent.click(screen.getByRole('button', { name: /add profile/i }))
    // The open profile card exposes the bundle "Add competency" affordance.
    await userEvent.click(screen.getByRole('button', { name: /add competency/i }))
    const state = useStore.getState().data
    expect(state.key_competencies).toHaveLength(1)
    // The new competency is linked into this profile's bundle, in order.
    expect(state.key_qualifications[0].competency_ids).toEqual([state.key_competencies[0].id])
  })

  it('reorders bundle competencies (up/down) and offers a drag handle per row', async () => {
    const data = emptyStore()
    data.key_competencies.push(
      makeKeyCompetency({ id: 'c1', title: { en: 'Alpha' } }),
      makeKeyCompetency({ id: 'c2', title: { en: 'Beta' } }),
    )
    data.key_qualifications.push(makeKQ({ id: 'p1', tag_line: { en: 'Architect' }, competency_ids: ['c1', 'c2'] }))
    seed(data)
    // Expand the profile card so its bundle editor renders.
    useStore.setState({ expandedItemId: 'p1' })
    render(<ProfileEditor />)

    // A drag handle per bundle row (the DnD affordance) plus the up/down fallback.
    expect(screen.getAllByRole('button', { name: /drag competency to reorder/i })).toHaveLength(2)

    // Up/down reorders competency_ids (same mutation path drag commits). Exact
    // name so it doesn't also match the profile card's "Move down in this section".
    await userEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0])
    expect(useStore.getState().data.key_qualifications[0].competency_ids).toEqual(['c2', 'c1'])
  })

  it('adds several existing competencies to the bundle at once via checkboxes', async () => {
    const data = emptyStore()
    data.key_competencies.push(
      makeKeyCompetency({ id: 'c1', title: { en: 'Alpha' } }),
      makeKeyCompetency({ id: 'c2', title: { en: 'Beta' } }),
      makeKeyCompetency({ id: 'c3', title: { en: 'Gamma' } }),
    )
    // The profile starts with just c1; c2 and c3 are the reusable library.
    data.key_qualifications.push(makeKQ({ id: 'p1', tag_line: { en: 'Architect' }, competency_ids: ['c1'] }))
    seed(data)
    useStore.setState({ expandedItemId: 'p1' })
    render(<ProfileEditor />)

    await userEvent.click(screen.getByRole('button', { name: /add existing/i }))
    // Tick Beta and Gamma, leave nothing else, add them in one action.
    await userEvent.click(screen.getByRole('checkbox', { name: /Beta/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Gamma/ }))
    await userEvent.click(screen.getByRole('button', { name: /add selected \(2\)/i }))

    expect(useStore.getState().data.key_qualifications[0].competency_ids).toEqual(['c1', 'c2', 'c3'])
    // Panel closes after adding.
    expect(screen.queryByRole('button', { name: /add selected/i })).toBeNull()
  })
})

describe('KeyCompetenciesEditor — by-profile grouping', () => {
  beforeEach(() => resetStore())

  function seedGrouped() {
    const data = emptyStore()
    data.key_competencies.push(
      makeKeyCompetency({ id: 'c1', title: { en: 'Shared' } }),
      makeKeyCompetency({ id: 'c2', title: { en: 'Solo' } }),
      makeKeyCompetency({ id: 'c3', title: { en: 'Loose' } }),
    )
    // c1 is in BOTH profiles; c2 only in p1; c3 in none (unassigned).
    data.key_qualifications.push(
      makeKQ({ id: 'p1', tag_line: { en: 'Architect' }, competency_ids: ['c1', 'c2'] }),
      makeKQ({ id: 'p2', tag_line: { en: 'Leader' }, competency_ids: ['c1'] }),
    )
    seed(data)
  }

  it('shows a competency once per profile it belongs to, plus an Unassigned group', async () => {
    seedGrouped()
    render(<KeyCompetenciesEditor />)
    await userEvent.click(screen.getByRole('button', { name: 'By profile' }))

    expect(screen.getByText('Architect')).toBeInTheDocument()
    expect(screen.getByText('Leader')).toBeInTheDocument()
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
    // c1 ("Shared") is in two profiles → rendered twice (once per group).
    expect(screen.getAllByRole('button', { name: 'Shared' })).toHaveLength(2)
    // c2 only in p1 → once; c3 unassigned → once.
    expect(screen.getAllByRole('button', { name: 'Solo' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Loose' })).toHaveLength(1)
  })

  it('opens a competency in a lightbox when a chip is clicked', async () => {
    seedGrouped()
    render(<KeyCompetenciesEditor />)
    await userEvent.click(screen.getByRole('button', { name: 'By profile' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Shared' })[0])
    expect(screen.getByRole('dialog', { name: 'Edit competency' })).toBeInTheDocument()
  })

  it('deletes a competency (and detaches it from every profile) from the by-profile lightbox', async () => {
    seedGrouped()
    render(<KeyCompetenciesEditor />)
    await userEvent.click(screen.getByRole('button', { name: 'By profile' }))
    // Open "Shared" (in p1 AND p2) then delete it via the lightbox trash icon.
    await userEvent.click(screen.getAllByRole('button', { name: 'Shared' })[0])
    const lightbox = screen.getByRole('dialog', { name: 'Edit competency' })
    await userEvent.click(within(lightbox).getByRole('button', { name: 'Delete' }))
    // Confirm in the branded confirm dialog.
    const confirm = screen.getByRole('dialog', { name: 'Delete competency?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      const state = useStore.getState().data
      expect(state.key_competencies.find((c) => c.id === 'c1')).toBeUndefined()
      // Detached from both profiles it belonged to — no dangling ids.
      expect(state.key_qualifications.find((q) => q.id === 'p1')!.competency_ids).toEqual(['c2'])
      expect(state.key_qualifications.find((q) => q.id === 'p2')!.competency_ids).toEqual([])
    })
  })
})

describe('KeyCompetenciesEditor — profile membership pencil', () => {
  beforeEach(() => resetStore())

  function seedMembership() {
    const data = emptyStore()
    data.key_competencies.push(makeKeyCompetency({ id: 'c1', title: { en: 'Alpha' } }))
    data.key_qualifications.push(
      makeKQ({ id: 'p1', tag_line: { en: 'Architect' }, competency_ids: ['c1'] }),
      makeKQ({ id: 'p2', tag_line: { en: 'Leader' }, competency_ids: [] }),
    )
    seed(data)
    // Expand the competency card so its membership editor renders (List view).
    useStore.setState({ expandedItemId: 'c1' })
  }

  it('adds the competency to another profile via the multi-select popover', async () => {
    seedMembership()
    render(<KeyCompetenciesEditor />)

    await userEvent.click(screen.getByRole('button', { name: /edit profile membership/i }))
    // Architect is ticked (member), Leader is not.
    expect(screen.getByRole('checkbox', { name: 'Architect' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Leader' })).not.toBeChecked()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Leader' }))
    expect(useStore.getState().data.key_qualifications.find((q) => q.id === 'p2')!.competency_ids).toEqual(['c1'])
  })

  it('removes the competency from a profile by un-ticking it', async () => {
    seedMembership()
    render(<KeyCompetenciesEditor />)

    await userEvent.click(screen.getByRole('button', { name: /edit profile membership/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Architect' }))
    expect(useStore.getState().data.key_qualifications.find((q) => q.id === 'p1')!.competency_ids).toEqual([])
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
