/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResumeViewsEditor } from '../../src/components/editor/ResumeViewsEditor'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeView } from '../fixtures'
import { buildViewHtml, buildViewSections } from '../../src/lib/viewFilter'

/**
 * Stub the lazily-imported PDF module.
 *
 * ViewEditor runs a 700 ms debounced `import('lib/pdfExporter')` to get the
 * exact page count. Unmocked, every test that mounts the editor pulls in
 * pdfmake (~1.2 MB plus ~0.9 MB of font vfs) and lays out a real PDF —
 * synchronous CPU work that starves the timer queue `waitFor`/`findBy` poll
 * on. Under a full 143-file parallel run that was enough to blow the whole
 * 15 s test budget, which is why the pop-out tests failed intermittently here
 * while passing in isolation on identical code.
 *
 * Nothing in this file asserts on the page count, so stubbing it removes the
 * work rather than hiding a behaviour.
 */
vi.mock('../../src/lib/pdfExporter', () => ({
  countPdfPages: vi.fn().mockResolvedValue(1),
  exportPdf: vi.fn().mockResolvedValue(undefined),
}))

// The list-page export tests assert on the download call (file per view, one
// per pick) — jsdom would otherwise silently "download" via a blob anchor.
const downloadText = vi.fn()
vi.mock('../../src/lib/download', () => ({
  downloadText: (...args: unknown[]) => downloadText(...args),
  downloadBlob: vi.fn(),
}))

// Wrap (not replace) buildViewText so the locale each export ran with is
// observable while the real output still flows to the download mock.
const buildViewTextSpy = vi.fn()
vi.mock('../../src/lib/viewText', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/lib/viewText')>()
  return {
    ...mod,
    buildViewText: (...args: Parameters<typeof mod.buildViewText>) => {
      buildViewTextSpy(...args)
      return mod.buildViewText(...args)
    },
  }
})

function seed() {
  useStore.setState({
    data: emptyStore(), hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'views', expandedItemId: null, mutationCount: 0,
  })
}

/**
 * Per-test budget for this file, replacing the global 15s.
 *
 * Every test here mounts the whole view editor including the LIVE PREVIEW,
 * which is genuinely timer-driven work: a debounced rebuild of the view HTML, a
 * 400ms re-measure after each iframe load, and a debounced page count. That is
 * the thing under test, so it can't be mocked away — the cheap fat was already
 * removed (pdfExporter is stubbed above, see the note there).
 *
 * The result is the suite's slowest file by a wide margin: ~50s for 26 tests
 * normally, ~214s under v8 coverage instrumentation, which costs ~2.7x. The
 * `npm run test:coverage` job therefore failed on the export-dropdown test at
 * 16.1s while the same test takes 2.2s uncontended — a flake produced by
 * measuring, not a hang.
 *
 * Applied to the WHOLE FILE this time. It was previously scoped to the pop-out
 * block, whose note predicted exactly what then happened: raising it for the
 * slowest tests only moves the failure to the next-slowest sibling. Left at the
 * global 15s everywhere else, so a real hang elsewhere still fails fast.
 */
const FILE_TIMEOUT_MS = 40_000

describe('<ResumeViewsEditor>', { timeout: FILE_TIMEOUT_MS }, () => {
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

  it('opens the editor by clicking anywhere on the card, not just the Edit button', async () => {
    seed()
    useStore.setState({
      data: { ...emptyStore(), views: [makeView({ id: 'v1', name: 'Board CV', purpose: 'For board roles' })] },
    })
    render(<ResumeViewsEditor />)

    // The purpose text sits in the card body, far from the Edit button.
    await userEvent.click(screen.getByText('For board roles'))
    expect(useStore.getState().activeViewId).toBe('v1')
    expect(screen.getByRole('button', { name: /all views/i })).toBeInTheDocument()
  })

  it('the card body is a real link, so a view can open in its own tab', () => {
    seed()
    useStore.setState({
      data: { ...emptyStore(), views: [makeView({ id: 'v1', name: 'Board CV' })] },
      currentResumeId: 'resume-1',
    })
    render(<ResumeViewsEditor />)

    const link = screen.getByRole('link', { name: /board cv/i })
    expect(link).toHaveAttribute('href', '/r/resume-1/views/v1')
  })

  it('exports a view straight from the list, in its own language, without opening it', async () => {
    seed()
    const store = emptyStore()
    store.resume = { ...store.resume!, supported_locales: ['en', 'no'] }
    store.views.push(makeView({ id: 'v1', name: 'Board CV', export_locale: 'no' }))
    useStore.setState({ data: store })
    downloadText.mockClear()
    buildViewTextSpy.mockClear()
    render(<ResumeViewsEditor />)

    await userEvent.click(screen.getByRole('button', { name: /^export$/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /text \(ats\)/i }))

    await waitFor(() => expect(downloadText).toHaveBeenCalledTimes(1))
    // Exported in the view's persisted language — not the editing language.
    expect(buildViewTextSpy).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ id: 'v1' }), 'no',
    )
    // The export stamps the view and never opened the editor.
    expect(useStore.getState().data.views[0].last_exported_at).toBeTruthy()
    expect(useStore.getState().activeViewId).toBeNull()
  })

  it('Export all downloads every view in the picked format and stamps each one', async () => {
    seed()
    const store = emptyStore()
    store.views.push(
      makeView({ id: 'v1', name: 'Board CV' }),
      makeView({ id: 'v2', name: 'Consultant CV' }),
    )
    useStore.setState({ data: store })
    downloadText.mockClear()
    render(<ResumeViewsEditor />)

    await userEvent.click(screen.getByRole('button', { name: /export all/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /markdown/i }))

    await waitFor(() => expect(downloadText).toHaveBeenCalledTimes(2))
    // One file per view, told apart by the view name in the filename.
    const names = downloadText.mock.calls.map((c) => c[1] as string)
    expect(names[0]).not.toBe(names[1])
    for (const v of useStore.getState().data.views) {
      expect(v.last_exported_at).toBeTruthy()
    }
  })

  it('hides the Export-all language selector while only one language is being edited', () => {
    seed()
    const store = emptyStore()
    store.views.push(makeView({ id: 'v1', name: 'Board CV' }))
    useStore.setState({ data: store, secondaryLocale: null })
    render(<ResumeViewsEditor />)

    expect(screen.getByRole('button', { name: /export all/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/export all — language/i)).not.toBeInTheDocument()
  })

  it('Export all in the SECONDARY language exports every view in it', async () => {
    seed()
    const store = emptyStore()
    store.resume = { ...store.resume!, supported_locales: ['en', 'no'] }
    store.views.push(makeView({ id: 'v1', name: 'Board CV' }))
    useStore.setState({ data: store, primaryLocale: 'en', secondaryLocale: 'no' })
    downloadText.mockClear()
    buildViewTextSpy.mockClear()
    render(<ResumeViewsEditor />)

    await userEvent.selectOptions(screen.getByLabelText(/export all — language/i), 'secondary')
    await userEvent.click(screen.getByRole('button', { name: /export all/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /text \(ats\)/i }))

    await waitFor(() => expect(downloadText).toHaveBeenCalledTimes(1))
    expect(buildViewTextSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'no')
  })

  it('Export all in BOTH languages: one file per view per language, locale in the name', async () => {
    seed()
    const store = emptyStore()
    store.resume = { ...store.resume!, supported_locales: ['en', 'no'] }
    store.views.push(
      makeView({ id: 'v1', name: 'Board CV' }),
      makeView({ id: 'v2', name: 'Consultant CV' }),
    )
    useStore.setState({ data: store, primaryLocale: 'en', secondaryLocale: 'no' })
    downloadText.mockClear()
    buildViewTextSpy.mockClear()
    render(<ResumeViewsEditor />)

    await userEvent.selectOptions(screen.getByLabelText(/export all — language/i), 'both')
    await userEvent.click(screen.getByRole('button', { name: /export all/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /text \(ats\)/i }))

    await waitFor(() => expect(downloadText).toHaveBeenCalledTimes(4))
    // The locale in the filename is what keeps the pair from colliding in the
    // download folder — without it the browser dedupes one into "…(1)".
    const names = downloadText.mock.calls.map((c) => c[1] as string)
    expect(new Set(names).size).toBe(4)
    expect(names.filter((n) => n.includes('EN'))).toHaveLength(2)
    expect(names.filter((n) => n.includes('NO'))).toHaveLength(2)
    const localesUsed = buildViewTextSpy.mock.calls.map((c) => c[2] as string)
    expect(localesUsed.filter((l) => l === 'en')).toHaveLength(2)
    expect(localesUsed.filter((l) => l === 'no')).toHaveLength(2)
    for (const v of useStore.getState().data.views) {
      expect(v.last_exported_at).toBeTruthy()
    }
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

  it('records a purpose note on the view and shows it on the card', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    // Purpose is read-only until the edit pencil is clicked (like the name).
    await userEvent.click(screen.getByRole('button', { name: /edit purpose/i }))
    await userEvent.type(screen.getByLabelText(/purpose/i), 'For the Equinor architect role')
    expect(useStore.getState().data.views[0].purpose).toBe('For the Equinor architect role')

    // Back on the list, the note is what tells the views apart.
    await userEvent.click(screen.getByRole('button', { name: /all views/i }))
    expect(screen.getByText('For the Equinor architect role')).toBeInTheDocument()
  })

  it('shows the purpose read-only with a pencil; the "never exported" caveat only in edit mode', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    // Read-only: the "Purpose" label shows, but there's no editable textbox and
    // no "never exported" caveat until you open it.
    expect(screen.getByText('Purpose')).toBeInTheDocument()
    expect(screen.queryByText(/never exported/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /purpose/i })).not.toBeInTheDocument()

    // The pencil opens edit mode → the textbox and the caveat appear.
    await userEvent.click(screen.getByRole('button', { name: /edit purpose/i }))
    expect(screen.getByRole('textbox', { name: /purpose/i })).toBeInTheDocument()
    expect(screen.getByText(/never exported/i)).toBeInTheDocument()
  })

  it('keeps the purpose note out of the exported document', async () => {
    // The note sits right above the exported Introduction field; it is a note
    // to self and must never reach a render path.
    seed()
    useStore.setState({
      data: {
        ...emptyStore(),
        views: [makeView({ purpose: 'SECRET-INTERNAL-NOTE', sections: buildViewSections() })],
      },
    })
    const view = useStore.getState().data.views[0]
    const html = buildViewHtml(useStore.getState().data, view, 'en')
    expect(html).not.toContain('SECRET-INTERNAL-NOTE')
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

  it('the Tabulated mode maps to summary detail + tabulate, and Summary clears it', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    // Projects supports all four modes (unlike the professional summary).
    const row = screen.getByText('Projects').closest('.rv-sec-row') as HTMLElement
    const secOf = () => useStore.getState().data.views[0].sections.find((s) => s.key === 'projects')!

    await userEvent.click(within(row).getByRole('radio', { name: /^tabulated$/i }))
    expect(secOf().detail).toBe('summary')
    expect(secOf().style?.tabulate).toBe(true)

    await userEvent.click(within(row).getByRole('radio', { name: /^summary$/i }))
    expect(secOf().detail).toBe('summary')
    expect(secOf().style?.tabulate).toBeFalsy()
  })

  it('the professional summary offers Off, Summary and Full modes (no Tabulated)', async () => {
    // Summary mode (short summary) vs Full mode (the long "Full profile") — the
    // prose block has no tabulated column layout, so that mode is excluded.
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))
    const row = screen.getByText('Profiles').closest('.rv-sec-row') as HTMLElement
    const names = within(row).getAllByRole('radio').map((r) => r.textContent)
    expect(names).toEqual(['Off', 'Summary', 'Full'])
  })

  it('shows the short-description placement control in plain summary mode only', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))
    // Projects supports summary + tabulated.
    const row = screen.getByText('Projects').closest('.rv-sec-row') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: /^expand .* settings$/i }))
    await userEvent.click(within(row).getByRole('radio', { name: /^summary$/i }))
    expect(within(row).getByLabelText(/short-description placement/i)).toBeInTheDocument()
    // Tabulated is a distinct mode — the short-description line doesn't apply.
    await userEvent.click(within(row).getByRole('radio', { name: /^tabulated$/i }))
    expect(within(row).queryByLabelText(/short-description placement/i)).not.toBeInTheDocument()
  })

  it('offers a per-section item sort in the expanded panel', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))
    const expandBtn = screen.getAllByRole('button', { name: /^expand .* settings$/i })[0]
    await userEvent.click(expandBtn)
    expect(screen.getAllByLabelText(/section item sort/i).length).toBeGreaterThan(0)
  })

  it('an Off section keeps its expander and expands to items but hides style overrides', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))
    // Turn the first section off.
    await userEvent.click(screen.getAllByRole('radio', { name: /^off$/i })[0])
    // Off sections keep an expander (labelled "… items", not "… settings").
    const expandBtn = screen.getAllByRole('button', { name: /^expand .* items$/i })[0]
    const row = expandBtn.closest('.rv-sec-row') as HTMLElement
    await userEvent.click(expandBtn)
    // Expanded, but with no style-overrides panel (nothing to style when hidden).
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
    // Seeded from the persisted view locale
    expect(select.value).toBe('no')

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

  describe('preview pop-out / pop-in', () => {
    // A stand-in for the popped-out window: jsdom doesn't implement window.open.
    function fakeWindow() {
      return {
        document: { open: vi.fn(), write: vi.fn(), close: vi.fn() },
        focus: vi.fn(), close: vi.fn(), closed: false,
      }
    }

    afterEach(() => vi.restoreAllMocks())

    async function openViewEditor() {
      seed()
      render(<ResumeViewsEditor />)
      await userEvent.click(screen.getByRole('button', { name: /new view/i }))
    }

    it('pops out to a window (hiding the inline pane) and pops back in, killing the window', async () => {
      const win = fakeWindow()
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
      await openViewEditor()

      // Inline preview visible to start.
      expect(screen.getByTitle('Resume View preview')).toBeInTheDocument()

      // Pop out: opens a window, writes the HTML, hides the inline pane, and the
      // button flips to "Pop in". (The pane unmounts a tick after the click, so
      // wait for the button flip / iframe removal rather than asserting sync.)
      await userEvent.click(screen.getByRole('button', { name: /^pop out$/i }))
      expect(openSpy).toHaveBeenCalledTimes(1)
      expect(win.document.write).toHaveBeenCalled()
      await screen.findByRole('button', { name: /^pop in$/i })
      await waitFor(() => expect(screen.queryByTitle('Resume View preview')).not.toBeInTheDocument())

      // Pop in: closes the window and restores the inline pane.
      await userEvent.click(screen.getByRole('button', { name: /^pop in$/i }))
      expect(win.close).toHaveBeenCalledTimes(1)
      expect(await screen.findByTitle('Resume View preview')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^pop out$/i })).toBeInTheDocument()
    })

    it('can re-show the inline preview while the pop-out window is still active', async () => {
      const win = fakeWindow()
      vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
      await openViewEditor()

      await userEvent.click(screen.getByRole('button', { name: /^pop out$/i }))
      // Inline hidden, but the window is still open (still showing "Pop in").
      await screen.findByRole('button', { name: /^pop in$/i })
      await waitFor(() => expect(screen.queryByTitle('Resume View preview')).not.toBeInTheDocument())

      // Show preview brings the inline pane back WITHOUT closing the window.
      await userEvent.click(screen.getByRole('button', { name: /show preview/i }))
      expect(await screen.findByTitle('Resume View preview')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^pop in$/i })).toBeInTheDocument()
      expect(win.close).not.toHaveBeenCalled()
    })

    it('surfaces a clear error when the browser blocks the pop-up', async () => {
      vi.spyOn(window, 'open').mockReturnValue(null)
      await openViewEditor()
      await userEvent.click(screen.getByRole('button', { name: /^pop out$/i }))
      expect(screen.getByRole('alert')).toHaveTextContent(/allow pop-ups/i)
      // The inline preview stays put when the window couldn't open.
      expect(screen.getByTitle('Resume View preview')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^pop out$/i })).toBeInTheDocument()
    })
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
