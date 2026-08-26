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

  it('shows a filled name as a locked display and edits it via the pencil', async () => {
    const user = userEvent.setup()
    seed()
    render(<HeaderEditor />)
    // Filled = display text, not an input — the write-once pattern.
    expect(screen.queryByDisplayValue('Test Person')).toBeNull()
    expect(screen.getByText('Test Person')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /edit full name/i }))
    const input = screen.getByDisplayValue('Test Person')
    await user.clear(input)
    await user.type(input, 'Astrid Solberg')
    // waitFor: the controlled input commits per keystroke; poll the store so a
    // scheduling hiccup under load can't flake the read (still asserts the
    // exact final value).
    await waitFor(() => expect(useStore.getState().data.resume?.full_name).toBe('Astrid Solberg'))
  })

  it('typing into an EMPTY name keeps the input mounted for the whole word', async () => {
    // Regression: the first keystroke made the value non-empty while the
    // wrapper's `editing` was still false, so the write-once field unmounted
    // its input MID-WORD — one character kept, the rest dropped. Focus must
    // mark editing-in-progress; the display takes over only on blur. The
    // keyboard-only e2e journey (a11y.spec.ts) is what caught it.
    const user = userEvent.setup()
    useStore.setState({
      data: { ...emptyStore(), resume: makeResume({ full_name: '' }) },
      hasData: true, activeSection: 'header',
      primaryLocale: 'en', secondaryLocale: null, expandedItemId: null, mutationCount: 0,
    })
    render(<HeaderEditor />)

    const input = screen.getByLabelText('Full name')
    await user.click(input)
    await user.type(input, 'Kari Nordmann')
    expect(useStore.getState().data.resume?.full_name).toBe('Kari Nordmann')
    // Still the input while focused…
    expect(screen.getByLabelText('Full name')).toBeInTheDocument()
    // …and the locked display only after leaving the field.
    await user.tab()
    expect(screen.getByText('Kari Nordmann')).toBeInTheDocument()
    expect(screen.queryByLabelText('Full name')).toBeNull()
  })

  it('an EMPTY name opens straight into the input — nothing to protect yet', () => {
    seed()
    useStore.setState((s) => ({ data: { ...s.data, resume: { ...s.data.resume!, full_name: '' } } }))
    render(<HeaderEditor />)
    expect(screen.getByLabelText('Full name')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit full name/i })).toBeNull()
  })

  it('carries the regrouped fields: personal website and the generic social slot', async () => {
    const user = userEvent.setup()
    seed()
    render(<HeaderEditor />)
    await user.type(screen.getByLabelText('Personal website'), 'https://me.example')
    await waitFor(() => expect(useStore.getState().data.resume?.personal_website_url).toBe('https://me.example'))
    // The old Twitter/X field is gone; its storage slot backs the generic one.
    expect(screen.queryByText(/twitter/i)).toBeNull()
    await user.type(screen.getByLabelText('Other social media URL'), 'https://mastodon.social/@a')
    await waitFor(() => expect(useStore.getState().data.resume?.twitter).toBe('https://mastodon.social/@a'))
  })

  it('exposes no personal-details Title field (it comes from the profile tag line)', () => {
    seed()
    render(<HeaderEditor />)
    // There is no single master "Title" — the professional headline is the
    // selected profile's tag line, chosen per view.
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
