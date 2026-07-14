/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResumeViewsEditor } from '../../src/components/editor/ResumeViewsEditor'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore } from '../fixtures'

function seed() {
  useStore.setState({
    data: emptyStore(), hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'views', expandedItemId: null, mutationCount: 0,
  })
}

describe('<ResumeViewsEditor>', () => {
  beforeEach(() => resetStore())

  it('shows an empty state when there are no views', () => {
    seed()
    render(<ResumeViewsEditor />)
    expect(screen.getByText(/no views yet/i)).toBeInTheDocument()
  })

  it('creates a view and opens the editor', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    expect(useStore.getState().data.views).toHaveLength(1)
    // Editor is now showing — the "All views" back button appears.
    expect(screen.getByRole('button', { name: /all views/i })).toBeInTheDocument()
  })

  it('renames the active view', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    // The name is display-only until opened with the edit pencil.
    await userEvent.click(screen.getByRole('button', { name: /edit view name/i }))
    const nameInput = screen.getByDisplayValue('New View')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Board CV')
    expect(useStore.getState().data.views[0].name).toBe('Board CV')
  })

  it('section rows are collapsed by default and expand to reveal style overrides + items', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    // Collapsed by default: no style-overrides panels are rendered yet.
    expect(screen.queryAllByText(/style overrides/i)).toHaveLength(0)

    // Expanding one section reveals its style overrides immediately (no second
    // click) — they are almost always what needs adjusting.
    const expandBtns = screen.getAllByRole('button', { name: /^expand .* settings$/i })
    expect(expandBtns.length).toBeGreaterThan(0)
    await userEvent.click(expandBtns[0])
    expect(screen.getAllByText(/style overrides/i)).toHaveLength(1)
  })

  it('expands and collapses a section by clicking its box (not just the arrow)', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    // Collapsed by default — no style-override panels rendered.
    expect(screen.queryAllByText(/style overrides/i)).toHaveLength(0)

    // Click the section TITLE (outside the off/summary/full toggle) → expands.
    const expandBtn = screen.getAllByRole('button', { name: /^expand .* settings$/i })[0]
    const row = expandBtn.closest('.rv-sec-row') as HTMLElement
    await userEvent.click(row.querySelector('.rv-sec-title') as HTMLElement)
    expect(within(row).getAllByText(/style overrides/i).length).toBeGreaterThan(0)

    // Click the title again → collapses.
    await userEvent.click(row.querySelector('.rv-sec-title') as HTMLElement)
    expect(within(row).queryAllByText(/style overrides/i)).toHaveLength(0)
  })

  it('clicking the detail toggle does not expand the section', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))
    // Clicking "summary" changes the detail but must NOT expand the box.
    const summaryBtns = screen.getAllByRole('radio', { name: /^summary$/i })
    await userEvent.click(summaryBtns[0])
    expect(screen.queryAllByText(/style overrides/i)).toHaveLength(0)
  })

  it('switches a section to off via the detail toggle', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    // promoted_projects defaults to 'off', so a fresh view already has one
    // 'off' section. The first section row (Profile & Summary) is 'full'.
    const offBefore = useStore.getState().data.views[0].sections.filter((s) => s.detail === 'off').length

    // Click the first section's "off" radio button.
    const offBtns = screen.getAllByRole('radio', { name: /^off$/i })
    await userEvent.click(offBtns[0])

    const offAfter = useStore.getState().data.views[0].sections.filter((s) => s.detail === 'off').length
    expect(offAfter).toBe(offBefore + 1)
  })

  it('switches a section to summary via the detail toggle', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    const summaryBtns = screen.getAllByRole('radio', { name: /^summary$/i })
    await userEvent.click(summaryBtns[0])

    const summaryCount = useStore.getState().data.views[0].sections.filter((s) => s.detail === 'summary').length
    expect(summaryCount).toBe(1)
  })

  it('changes view-level density via the styling controls', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    // Scope to the view-wide styling block — sections also have a density
    // override control now.
    const stylingBlock = screen.getByText('View styling').closest('.rv-section-block') as HTMLElement
    const densitySelect = within(stylingBlock).getByLabelText(/density/i)
    await userEvent.selectOptions(densitySelect, 'compact')

    expect(useStore.getState().data.views[0].style.density).toBe('compact')
  })

  it('tailors a view from a pasted LLM response (paste → review → create)', async () => {
    seed()
    const store = useStore.getState().data
    useStore.setState({
      data: {
        ...store,
        projects: [
          ...store.projects,
          {
            ...((await import('../fixtures')).makeProject({ id: 'p-keep', customer: { en: 'KeepCo' } })),
          },
          {
            ...((await import('../fixtures')).makeProject({ id: 'p-drop', customer: { en: 'DropCo' } })),
          },
        ],
      },
    })
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /tailor from job posting/i }))

    const response = JSON.stringify({
      $schema: 'resumestudio-tailor/v1',
      view_name: 'Platform CV',
      introduction: 'A strong fit.',
      section_detail: { educations: 'off' },
      exclude_item_ids: ['p-drop'],
      gaps: ['Kubernetes'],
    })
    await userEvent.click(screen.getByPlaceholderText(/"\$schema": "resumestudio-tailor\/v1"/i))
    await userEvent.paste(response)
    await userEvent.click(screen.getByRole('button', { name: /review proposal/i }))

    // Preview shows the diff: excluded item title + gap list.
    expect(screen.getByText('DropCo')).toBeInTheDocument()
    expect(screen.getByText('Kubernetes')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /create this view/i }))
    const views = useStore.getState().data.views
    expect(views).toHaveLength(1)
    expect(views[0].name).toBe('Platform CV')
    expect(views[0].excluded_item_ids).toEqual(['p-drop'])
    expect(views[0].introduction.en).toBe('A strong fit.')
    expect(views[0].sections.find((s) => s.key === 'educations')?.detail).toBe('off')
    // Applying opened the new view in the editor.
    expect(screen.getByRole('button', { name: /all views/i })).toBeInTheDocument()
  })

  it('applies an export template: seeds style/header/footer + records template_id', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    const templateSelect = screen.getByLabelText(/template/i)
    await userEvent.selectOptions(templateSelect, 'minimal-one-pager')

    const view = useStore.getState().data.views[0]
    expect(view.template_id).toBe('minimal-one-pager')
    expect(view.style.density).toBe('compact')
    expect(view.header.photo_placement).toBe('none')
    expect(view.footer.separator).toBe('none')
    // Section detail got seeded (recommendations off on the one-pager).
    expect(view.sections.find((s) => s.key === 'recommendations')?.detail).toBe('off')
    // Style stays user-tweakable after applying a template.
    const stylingBlock = screen.getByText('View styling').closest('.rv-section-block') as HTMLElement
    await userEvent.selectOptions(within(stylingBlock).getByLabelText(/density/i), 'spacious')
    expect(useStore.getState().data.views[0].style.density).toBe('spacious')
  })

  it('seeds the export language from the view and persists a change (F11)', async () => {
    const { makeView, makeResume } = await import('../fixtures')
    const view = makeView({ id: 'v1', name: 'Board CV', export_locale: 'no' })
    useStore.setState({
      data: {
        ...emptyStore(),
        resume: makeResume({ supported_locales: ['en', 'no'] }),
        views: [view],
      },
      hasData: true, primaryLocale: 'en', secondaryLocale: null,
      activeSection: 'views', activeViewId: 'v1', expandedItemId: null, mutationCount: 0,
    })
    render(<ResumeViewsEditor />)

    const select = screen.getByLabelText(/export language/i) as HTMLSelectElement
    expect(select.value).toBe('no') // seeded from the persisted view locale

    await userEvent.selectOptions(select, 'en')
    expect(useStore.getState().data.views[0].export_locale).toBe('en')
  })

  it('lists Skills Showcase categories (not raw skills) as excludable items', async () => {
    const { makeSkill, makeSkillCategory } = await import('../fixtures')
    const store = emptyStore()
    store.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })]
    store.skills = [makeSkill({ id: 'sk1', name: { en: 'TypeScript' }, category_id: 'cat1', is_highlighted: true })]
    useStore.setState({
      data: store, hasData: true, primaryLocale: 'en', secondaryLocale: null,
      activeSection: 'views', expandedItemId: null, mutationCount: 0,
    })
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    // Scope to the Skills Showcase section row (its title is unique).
    const showcaseTitle = screen.getByText('Skills Showcase')
    const sectionRow = showcaseTitle.closest('.rv-sec-row')!
    // Section rows are collapsed by default — expand to reveal the item list.
    await userEvent.click(within(sectionRow as HTMLElement).getByRole('button', { name: /expand skills showcase/i }))
    // The category name appears as an excludable item; the raw skill name does not.
    expect(sectionRow.textContent).toContain('Languages')
    expect(sectionRow.textContent).not.toContain('TypeScript')

    const checkbox = Array.from(sectionRow.querySelectorAll('label.rv-item-row'))
      .find((el) => el.textContent?.includes('Languages'))!
      .querySelector('input[type="checkbox"]')!
    await userEvent.click(checkbox)
    expect(useStore.getState().data.views[0].excluded_item_ids).toContain('cat1')
  })

  it('edits the introduction text', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    await userEvent.type(
      screen.getByPlaceholderText('Write an introduction for this view…'),
      'Targeted for boards',
    )
    expect(useStore.getState().data.views[0].introduction.en).toBe('Targeted for boards')
  })

  it('exposes export actions via the top "Export view" dropdown', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    // The export controls now live at the top, beside the preview toggle: an
    // "Export view" dropdown and the language selector (which also drives the
    // live preview).
    expect(screen.getByLabelText(/export language/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /export view/i }))
    expect(screen.getByRole('menuitem', { name: /export pdf/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /export docx/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /text \(ats\)/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /markdown/i })).toBeInTheDocument()
  })
})
