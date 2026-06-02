/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SaveStatus } from '../../src/components/layout/SaveStatus'

describe('<SaveStatus>', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<SaveStatus state="idle" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the right label per state', () => {
    const labels = [
      ['saving', 'Saving…'],
      ['saved', 'Saved'],
      ['offline', 'Local only'],
      ['error', 'Save failed'],
    ] as const
    for (const [state, label] of labels) {
      const { unmount } = render(<SaveStatus state={state} />)
      expect(screen.getByText(label)).toBeInTheDocument()
      unmount()
    }
  })

  it('shows a Retry button only on error and calls onRetry', async () => {
    const onRetry = vi.fn()
    render(<SaveStatus state="error" onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('does not show Retry when saved', () => {
    render(<SaveStatus state="saved" onRetry={() => {}} />)
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })
})
