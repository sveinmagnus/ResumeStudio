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
import { emptyStore, makePosition, makeProject } from '../fixtures'

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

  describe('type facets', () => {
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

    it('offers a chip per type present, with a count', async () => {
      const row = await openSection(/^expand other roles settings$/i)
      expect(within(row).getByRole('checkbox', { name: /board member — 2 of 2 selected/i })).toBeInTheDocument()
      expect(within(row).getByRole('checkbox', { name: /volunteer — 1 of 1 selected/i })).toBeInTheDocument()
      // A type the resume has no items for gets no chip.
      expect(within(row).queryByRole('checkbox', { name: /mentor —/i })).not.toBeInTheDocument()
    })


    it('deselects a whole type in one click, leaving other types alone', async () => {
      const row = await openSection(/^expand other roles settings$/i)
      await userEvent.click(within(row).getByRole('checkbox', { name: /board member —/i }))
      expect(view().excluded_item_ids.sort()).toEqual(['b1', 'b2'])
    })

    it('reselects a whole type', async () => {
      const row = await openSection(/^expand other roles settings$/i)
      const chip = () => within(row).getByRole('checkbox', { name: /board member —/i })
      await userEvent.click(chip())
      await userEvent.click(chip())
      expect(view().excluded_item_ids).toEqual([])
    })

    it('shows a partly-selected type as indeterminate, not unchecked', async () => {
      const row = await openSection(/^expand other roles settings$/i)
      // Untick ONE of the two board seats via its own item row (b1 sorts first).
      await userEvent.click(row.querySelectorAll('.rv-item-check')[0] as HTMLElement)
      expect(view().excluded_item_ids).toEqual(['b1'])

      const chip = within(row).getByRole('checkbox', { name: /board member — 1 of 2 selected/i }) as HTMLInputElement
      expect(chip.indeterminate).toBe(true)
      expect(chip.checked).toBe(false)
    })

    it('has no facets for a section without a type field', async () => {
      useStore.setState({
        data: { ...useStore.getState().data, projects: [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })] },
      })
      const row = await openSection(/^expand projects settings$/i)
      // Bulk buttons yes, type chips no.
      expect(within(row).getByRole('button', { name: /^none$/i })).toBeInTheDocument()
      expect(row.querySelector('.rv-item-facets')).toBeNull()
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
})
