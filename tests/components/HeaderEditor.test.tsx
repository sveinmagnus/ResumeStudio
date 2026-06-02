/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HeaderEditor } from '../../src/components/editor/HeaderEditor'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeResume } from '../fixtures'

function seed() {
  useStore.setState({
    data: { ...emptyStore(), resume: makeResume({ full_name: 'Test Person', title: { en: 'Consultant' } }) },
    hasData: true,
    primaryLocale: 'en',
    secondaryLocale: null,
    expandedItemId: null,
    mutationCount: 0,
  })
}

describe('<HeaderEditor>', () => {
  beforeEach(() => resetStore())

  it('edits the full name through a plain TextField', async () => {
    seed()
    render(<HeaderEditor />)
    const input = screen.getByDisplayValue('Test Person')
    await userEvent.clear(input)
    await userEvent.type(input, 'Astrid Solberg')
    expect(useStore.getState().data.resume?.full_name).toBe('Astrid Solberg')
  })

  it('edits the localized title through a DualField', async () => {
    seed()
    render(<HeaderEditor />)
    const title = screen.getByDisplayValue('Consultant')
    await userEvent.type(title, ' Architect')
    expect(useStore.getState().data.resume?.title.en).toBe('Consultant Architect')
  })

  it('edits the email field', async () => {
    seed()
    render(<HeaderEditor />)
    const email = screen.getByDisplayValue('test@example.com')
    await userEvent.clear(email)
    await userEvent.type(email, 'astrid@cartavio.no')
    expect(useStore.getState().data.resume?.email).toBe('astrid@cartavio.no')
  })
})
