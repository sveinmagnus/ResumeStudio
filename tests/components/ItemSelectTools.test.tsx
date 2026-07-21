/**
 * @vitest-environment jsdom
 *
 * Bulk item selection, driven through the REAL view editor rather than the
 * control in isolation — the interesting risk is the wiring (does a click land
 * on the store, does it collapse the section it lives in), not the markup.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResumeViewsEditor } from '../../src/components/editor/ResumeViewsEditor'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makePosition, makeProject, makeEducation, makeRole, makeKQ } from '../fixtures'

/** Seed a resume, then create a view and expand `section`'s panel. */
async function openSection(section: RegExp) {
  render(<ResumeViewsEditor />)
  await userEvent.click(screen.getByRole('button', { name: /new view/i }))
  const expand = screen.getByRole('button', { name: section })
  await userEvent.click(expand)
  return expand.closest('.rv-sec-row') as HTMLElement
}

const view = () => useStore.getState().data.views[0]

describe('<ItemSelectTools>', () => {
  beforeEach(() => resetStore())

  describe('select all / none', () => {
    beforeEach(() => {
      useStore.setState({
        data: {
          ...emptyStore(),
          projects: [
            makeProject({ id: 'p1', sort_order: 0 }),
            makeProject({ id: 'p2', sort_order: 1 }),
            makeProject({ id: 'p3', sort_order: 2 }),
          ],
        },
        hasData: true, primaryLocale: 'en', secondaryLocale: null,
        activeSection: 'views', expandedItemId: null, mutationCount: 0,
      })
    })

    it('deselects every item in the section', async () => {
      const row = await openSection(/^expand projects settings$/i)
      await userEvent.click(within(row).getByRole('button', { name: /^none$/i }))
      expect(view().excluded_item_ids.sort()).toEqual(['p1', 'p2', 'p3'])
    })

    it('reselects every item in the section', async () => {
      const row = await openSection(/^expand projects settings$/i)
      await userEvent.click(within(row).getByRole('button', { name: /^none$/i }))
      await userEvent.click(within(row).getByRole('button', { name: /^all$/i }))
      expect(view().excluded_item_ids).toEqual([])
    })

    it('disables the button for the state already reached', async () => {
      const row = await openSection(/^expand projects settings$/i)
      // Nothing excluded yet → "All" is a no-op.
      expect(within(row).getByRole('button', { name: /^all$/i })).toBeDisabled()
      expect(within(row).getByRole('button', { name: /^none$/i })).toBeEnabled()

      await userEvent.click(within(row).getByRole('button', { name: /^none$/i }))
      expect(within(row).getByRole('button', { name: /^all$/i })).toBeEnabled()
      expect(within(row).getByRole('button', { name: /^none$/i })).toBeDisabled()
    })

    it('does not collapse the section it lives in', async () => {
      // The section box collapses on any click that isn't explicitly exempted,
      // so the tools row has to be in the click guard.
      const row = await openSection(/^expand projects settings$/i)
      await userEvent.click(within(row).getByRole('button', { name: /^none$/i }))
      expect(within(row).getByRole('button', { name: /^all$/i })).toBeInTheDocument()
    })

    it('leaves another section untouched', async () => {
      useStore.setState({
        data: {
          ...useStore.getState().data,
          positions: [makePosition({ id: 'x1', sort_order: 0 }), makePosition({ id: 'x2', sort_order: 1 })],
        },
      })
      const row = await openSection(/^expand projects settings$/i)
      await userEvent.click(within(row).getByRole('button', { name: /^none$/i }))
      // Projects gone; the Other-roles items are still in.
      expect(view().excluded_item_ids).not.toContain('x1')
      expect(view().excluded_item_ids).not.toContain('x2')
    })
  })

  describe('type facets (in the dropdown)', () => {
    beforeEach(() => {
      useStore.setState({
        data: {
          ...emptyStore(),
          positions: [
            makePosition({ id: 'b1', position_type: 'board_member', sort_order: 0 }),
            makePosition({ id: 'b2', position_type: 'board_member', sort_order: 1 }),
            makePosition({ id: 'v1', position_type: 'volunteer', sort_order: 2 }),
          ],
        },
        hasData: true, primaryLocale: 'en', secondaryLocale: null,
        activeSection: 'views', expandedItemId: null, mutationCount: 0,
      })
    })

    /** Expand Other roles and open its "By type" dropdown. */
    async function openFacets() {
      const row = await openSection(/^expand other roles settings$/i)
      await userEvent.click(within(row).getByRole('button', { name: /by type/i }))
      return row
    }

    it('hides chips until the dropdown is opened', async () => {
      // The facet chip's name ends "— N of M selected"; the item-row checkboxes
      // are named just by their title, so scope to the facet's distinctive name.
      const row = await openSection(/^expand other roles settings$/i)
      expect(within(row).queryByRole('checkbox', { name: /board member — .* selected/i })).not.toBeInTheDocument()
      await userEvent.click(within(row).getByRole('button', { name: /by type/i }))
      expect(within(row).getByRole('checkbox', { name: /board member — 2 of 2 selected/i })).toBeInTheDocument()
    })

    it('offers a chip per type present, with a count', async () => {
      const row = await openFacets()
      expect(within(row).getByRole('checkbox', { name: /board member — 2 of 2 selected/i })).toBeInTheDocument()
      expect(within(row).getByRole('checkbox', { name: /volunteer — 1 of 1 selected/i })).toBeInTheDocument()
      expect(within(row).queryByRole('checkbox', { name: /mentor —/i })).not.toBeInTheDocument()
    })

    it('deselects a whole type in one click, leaving other types alone', async () => {
      const row = await openFacets()
      await userEvent.click(within(row).getByRole('checkbox', { name: /board member —/i }))
      expect(view().excluded_item_ids.sort()).toEqual(['b1', 'b2'])
    })

    it('shows a partly-selected type as indeterminate, and badges the trigger', async () => {
      const row = await openSection(/^expand other roles settings$/i)
      // Untick ONE of the two board seats via its own item row (b1 sorts first).
      await userEvent.click(row.querySelectorAll('.rv-item-check')[0] as HTMLElement)
      expect(view().excluded_item_ids).toEqual(['b1'])
      // The collapsed trigger badges the one partial value.
      expect(within(row).getByText('1', { selector: '.rv-item-facet-badge' })).toBeInTheDocument()

      await userEvent.click(within(row).getByRole('button', { name: /by type/i }))
      const chip = within(row).getByRole('checkbox', { name: /board member — 1 of 2 selected/i }) as HTMLInputElement
      expect(chip.indeterminate).toBe(true)
      expect(chip.checked).toBe(false)
    })

    it('has no dropdown for a section without any facet', async () => {
      useStore.setState({
        data: { ...useStore.getState().data, educations: [makeEducation({ id: 'e1' }), makeEducation({ id: 'e2' })] },
      })
      const row = await openSection(/^expand education settings$/i)
      expect(within(row).getByRole('button', { name: /^none$/i })).toBeInTheDocument()
      expect(within(row).queryByRole('button', { name: /by type/i })).not.toBeInTheDocument()
    })
  })

  describe('role facet (multi-value, from the registry)', () => {
    it('selects only the projects carrying a chosen role', async () => {
      useStore.setState({
        data: {
          ...emptyStore(),
          roles: [makeRole({ id: 'pm', name: { en: 'PM' } }), makeRole({ id: 'dev', name: { en: 'Developer' } })],
          projects: [
            makeProject({ id: 'p1', sort_order: 0, roles: [{ id: 'x', role_id: 'pm', name: {}, sort_order: 0, disabled: false }] }),
            makeProject({ id: 'p2', sort_order: 1, roles: [
              { id: 'y', role_id: 'pm', name: {}, sort_order: 0, disabled: false },
              { id: 'z', role_id: 'dev', name: {}, sort_order: 1, disabled: false },
            ] }),
            makeProject({ id: 'p3', sort_order: 2, roles: [{ id: 'w', role_id: 'dev', name: {}, sort_order: 0, disabled: false }] }),
          ],
        },
        hasData: true, primaryLocale: 'en', secondaryLocale: null,
        activeSection: 'views', expandedItemId: null, mutationCount: 0,
      })
      const row = await openSection(/^expand projects settings$/i)
      await userEvent.click(within(row).getByRole('button', { name: /by type/i }))
      // Registry names label the chips.
      const pm = within(row).getByRole('checkbox', { name: /^PM — 2 of 2 selected/i })
      // Untick PM → both PM-carrying projects (incl. the PM+Dev one) drop.
      await userEvent.click(pm)
      expect(view().excluded_item_ids.sort()).toEqual(['p1', 'p2'])
      // Developer is now partial (p2 gone, p3 stays).
      const dev = within(row).getByRole('checkbox', { name: /^Developer — 1 of 2 selected/i }) as HTMLInputElement
      expect(dev.indeterminate).toBe(true)
    })
  })

  it('is absent for a section with a single item', async () => {
    useStore.setState({
      data: { ...emptyStore(), projects: [makeProject({ id: 'only' })] },
      hasData: true, primaryLocale: 'en', secondaryLocale: null,
      activeSection: 'views', expandedItemId: null, mutationCount: 0,
    })
    const row = await openSection(/^expand projects settings$/i)
    expect(within(row).queryByRole('button', { name: /^none$/i })).not.toBeInTheDocument()
  })

  describe('profile (single-select radio)', () => {
    beforeEach(() => {
      useStore.setState({
        data: {
          ...emptyStore(),
          key_qualifications: [
            makeKQ({ id: 'k1', label: { en: 'Generalist' }, sort_order: 0 }),
            makeKQ({ id: 'k2', label: { en: 'Specialist' }, sort_order: 1 }),
          ],
        },
        hasData: true, primaryLocale: 'en', secondaryLocale: null,
        activeSection: 'views', expandedItemId: null, mutationCount: 0,
      })
    })

    it('renders radios and shows no bulk tools', async () => {
      const row = await openSection(/^expand profiles settings$/i)
      expect(row.querySelector('input[type="radio"]')).toBeInTheDocument()
      expect(row.querySelector('input[type="checkbox"].rv-item-check')).toBeNull()
      // No All/None for a single-select section.
      expect(within(row).queryByRole('button', { name: /^none$/i })).not.toBeInTheDocument()
    })

    it('picking one block excludes every other', async () => {
      const row = await openSection(/^expand profiles settings$/i)
      const radios = row.querySelectorAll('input[type="radio"]')
      await userEvent.click(radios[1] as HTMLElement)
      // k2 kept, k1 excluded.
      expect(view().excluded_item_ids).toEqual(['k1'])
    })
  })
})
