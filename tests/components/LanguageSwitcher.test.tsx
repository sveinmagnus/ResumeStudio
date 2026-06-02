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

describe('<LanguageSwitcher>', () => {
  beforeEach(() => resetStore())

  it('swaps primary and secondary', async () => {
    seed('en', 'no')
    render(<LanguageSwitcher />)
    await userEvent.click(screen.getByTitle('Swap languages'))
    expect(useStore.getState().primaryLocale).toBe('no')
    expect(useStore.getState().secondaryLocale).toBe('en')
  })

  it('hides the secondary column via the toggle', async () => {
    seed('en', 'no')
    render(<LanguageSwitcher />)
    await userEvent.click(screen.getByTitle('Hide secondary column'))
    expect(useStore.getState().secondaryLocale).toBeNull()
  })

  it('clears the secondary via the "— none —" option', async () => {
    seed('en', 'no')
    render(<LanguageSwitcher />)
    await userEvent.selectOptions(screen.getByDisplayValue(/Norsk/), '')
    expect(useStore.getState().secondaryLocale).toBeNull()
  })

  it('disables the swap button when there is no secondary', () => {
    seed('en', null)
    render(<LanguageSwitcher />)
    expect(screen.getByTitle('Swap languages')).toBeDisabled()
  })
})
