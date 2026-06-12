/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageSwitcher } from '../../src/components/layout/LanguageSwitcher'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeResume } from '../fixtures'

function seed(primary = 'en', secondary: string | null = 'no') {
  useStore.setState({
    data: { ...emptyStore(), resume: makeResume({ supported_locales: ['en', 'no'] }) },
    hasData: true, primaryLocale: primary, secondaryLocale: secondary,
    expandedItemId: null, mutationCount: 0,
  })
}

/** The controls live in a popover — open it via the trigger first. */
async function openPopover() {
  await userEvent.click(screen.getByRole('button', { name: /language settings/i }))
}

describe('<LanguageSwitcher>', () => {
  beforeEach(() => resetStore())

  it('shows the current pair on the compact trigger and opens on click', async () => {
    seed('en', 'no')
    render(<LanguageSwitcher />)
    const trigger = screen.getByRole('button', { name: /language settings/i })
    expect(trigger).toHaveTextContent('EN / NO')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    // Controls are hidden until opened.
    expect(screen.queryByLabelText('Primary')).not.toBeInTheDocument()

    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Primary')).toBeInTheDocument()
  })

  it('shows only the primary code when no secondary is selected', () => {
    seed('en', null)
    render(<LanguageSwitcher />)
    expect(screen.getByRole('button', { name: /language settings/i })).toHaveTextContent(/^EN$/)
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    seed('en', 'no')
    render(<LanguageSwitcher />)
    await openPopover()
    await userEvent.keyboard('{Escape}')
    const trigger = screen.getByRole('button', { name: /language settings/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(trigger)
  })

  it('swaps primary and secondary', async () => {
    seed('en', 'no')
    render(<LanguageSwitcher />)
    await openPopover()
    await userEvent.click(screen.getByTitle('Swap languages'))
    expect(useStore.getState().primaryLocale).toBe('no')
    expect(useStore.getState().secondaryLocale).toBe('en')
  })

  it('hides the secondary column via the toggle', async () => {
    seed('en', 'no')
    render(<LanguageSwitcher />)
    await openPopover()
    await userEvent.click(screen.getByTitle('Hide secondary column'))
    expect(useStore.getState().secondaryLocale).toBeNull()
  })

  it('clears the secondary via the "— none —" option', async () => {
    seed('en', 'no')
    render(<LanguageSwitcher />)
    await openPopover()
    await userEvent.selectOptions(screen.getByDisplayValue(/Norsk/), '')
    expect(useStore.getState().secondaryLocale).toBeNull()
  })

  it('disables the swap button when there is no secondary', async () => {
    seed('en', null)
    render(<LanguageSwitcher />)
    await openPopover()
    expect(screen.getByTitle('Swap languages')).toBeDisabled()
  })
})
