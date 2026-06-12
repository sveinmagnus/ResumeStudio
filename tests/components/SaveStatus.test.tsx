/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SaveStatus } from '../../src/components/layout/SaveStatus'

describe('<SaveStatus>', () => {
  it('renders an empty live region when idle (no visible pill)', () => {
    render(<SaveStatus state="idle" />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('announces state transitions through the persistent role=status region', () => {
    // The live region must exist BEFORE content changes (WCAG 4.1.3) — it is
    // the same element across rerenders, only its content swaps.
    const { rerender } = render(<SaveStatus state="idle" />)
    const region = screen.getByRole('status')
    rerender(<SaveStatus state="saving" />)
    expect(region).toHaveTextContent('Saving…')
    rerender(<SaveStatus state="error" />)
    expect(region).toHaveTextContent('Save failed')
  })

  it('shows the right label per state', () => {
    const labels = [
      ['saving', 'Saving…'],
      ['saved', 'Saved'],
      ['offline', 'Offline — saved locally'],
      ['queued', 'Unsynced changes'],
      ['error', 'Save failed'],
      ['conflict', 'Changed elsewhere'],
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

  it('notes the multi-resume backlog on offline/queued when unsyncedCount > 1', () => {
    const { rerender } = render(<SaveStatus state="offline" unsyncedCount={3} />)
    expect(screen.getByText(/3 resumes/i)).toBeInTheDocument()
    // Not shown for a single unsynced resume…
    rerender(<SaveStatus state="offline" unsyncedCount={1} />)
    expect(screen.queryByText(/resumes/i)).not.toBeInTheDocument()
    // …nor on healthy states.
    rerender(<SaveStatus state="saved" unsyncedCount={3} />)
    expect(screen.queryByText(/3 resumes/i)).not.toBeInTheDocument()
  })
})
