/**
 * @vitest-environment jsdom
 *
 * SettingsTabs renders no styles of its own — the wide-rail-vs-narrow-popout
 * CSS lives entirely in SettingsModal.tsx, and jsdom has no real layout
 * engine to evaluate a `@media` viewport query against anyway. So this file
 * tests the thing jsdom CAN verify: the disclosure's React logic (state,
 * ARIA attributes, focus, keyboard/mouse handling) — independent of which
 * viewport a real browser happens to be showing it at. The actual visual
 * behavior (rail on wide screens, popout on narrow ones) was verified by hand
 * against the running app at both widths.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsTabs } from '../../src/components/settings/SettingsTabs'

const TABS = [
  { id: 'version', label: 'Version' },
  { id: 'translation', label: 'Translation' },
  { id: 'ai', label: 'AI assist' },
]

describe('<SettingsTabs> — the disclosure (narrow-width popout)', () => {
  it('starts collapsed, names the active tab, and opens on click', async () => {
    const user = userEvent.setup()
    render(<SettingsTabs tabs={TABS} active="translation" onChange={() => {}} />)

    const burger = screen.getByRole('button', { name: /translation/i })
    expect(burger).toHaveAttribute('aria-expanded', 'false')
    expect(burger).toHaveAttribute('aria-controls', 'sm-tablist')

    await user.click(burger)
    expect(burger).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows every tab at once when open — the whole point over a scrolling bar', async () => {
    const user = userEvent.setup()
    render(<SettingsTabs tabs={TABS} active="version" onChange={() => {}} />)
    await user.click(screen.getByRole('button', { name: /version/i }))

    for (const t of TABS) {
      expect(screen.getByRole('tab', { name: t.label })).toBeInTheDocument()
    }
  })

  it('opening moves focus to the SELECTED tab, not the first one', async () => {
    const user = userEvent.setup()
    render(<SettingsTabs tabs={TABS} active="ai" onChange={() => {}} />)
    await user.click(screen.getByRole('button', { name: /ai assist/i }))

    expect(screen.getByRole('tab', { name: 'AI assist' })).toHaveFocus()
  })

  it('clicking a tab selects it AND closes the popout — that is what "select" means here', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SettingsTabs tabs={TABS} active="version" onChange={onChange} />)

    const burger = screen.getByRole('button', { name: /version/i })
    await user.click(burger)
    await user.click(screen.getByRole('tab', { name: 'Translation' }))

    expect(onChange).toHaveBeenCalledWith('translation')
    expect(burger).toHaveAttribute('aria-expanded', 'false')
  })

  it('Escape closes and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<SettingsTabs tabs={TABS} active="version" onChange={() => {}} />)
    const burger = screen.getByRole('button', { name: /version/i })
    await user.click(burger)
    expect(burger).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')
    expect(burger).toHaveAttribute('aria-expanded', 'false')
    expect(burger).toHaveFocus()
  })

  it('a click outside closes it', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <SettingsTabs tabs={TABS} active="version" onChange={() => {}} />
        <button>outside</button>
      </div>,
    )
    const burger = screen.getByRole('button', { name: /version/i })
    await user.click(burger)
    expect(burger).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('button', { name: 'outside' }))
    expect(burger).toHaveAttribute('aria-expanded', 'false')
  })

  it('arrow keys move selection vertically (Down/Up) — both layouts stack vertically now', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SettingsTabs tabs={TABS} active="version" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /version/i }))

    screen.getByRole('tab', { name: 'Version' }).focus()
    await user.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenCalledWith('translation')
  })

  it('the tablist announces vertical orientation unconditionally — no horizontal fallback', () => {
    render(<SettingsTabs tabs={TABS} active="version" onChange={() => {}} />)
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical')
  })
})
