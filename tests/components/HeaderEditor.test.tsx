/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HeaderEditor } from '../../src/components/editor/HeaderEditor'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeResume } from '../fixtures'

function seed() {
  useStore.setState({
    data: { ...emptyStore(), resume: makeResume({ full_name: 'Test Person', title: { en: 'Consultant' } }) },
    hasData: true,
    activeSection: 'header',
    primaryLocale: 'en',
    secondaryLocale: null,
    expandedItemId: null,
    mutationCount: 0,
  })
}

describe('<HeaderEditor>', () => {
  beforeEach(() => resetStore())

  it('edits the full name through a plain TextField', async () => {
    const user = userEvent.setup()
    seed()
    render(<HeaderEditor />)
    const input = screen.getByDisplayValue('Test Person')
    await user.clear(input)
    await user.type(input, 'Astrid Solberg')
    // waitFor: the controlled input commits per keystroke; poll the store so a
    // scheduling hiccup under load can't flake the read (still asserts the
    // exact final value).
    await waitFor(() => expect(useStore.getState().data.resume?.full_name).toBe('Astrid Solberg'))
  })

  it('no longer exposes a personal-details Title field (it comes from the profile tag line now)', () => {
    seed()
    render(<HeaderEditor />)
    // The single master "Title" was removed — the professional headline is the
    // selected profile's tag line per view (see the Profile rework).
    expect(screen.queryByDisplayValue('Consultant')).toBeNull()
    expect(screen.queryByText('Title')).toBeNull()
  })

  it('edits the email field', async () => {
    const user = userEvent.setup()
    seed()
    render(<HeaderEditor />)
    const email = screen.getByDisplayValue('test@example.com')
    await user.clear(email)
    await user.type(email, 'astrid@cartavio.no')
    await waitFor(() => expect(useStore.getState().data.resume?.email).toBe('astrid@cartavio.no'))
  })
})
