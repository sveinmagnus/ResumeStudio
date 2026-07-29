// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollapsibleSection } from '../../src/components/ui/CollapsibleSection'

describe('<CollapsibleSection>', () => {
  /** Results have just arrived — burying them behind a click is the wrong trade. */
  it('starts open and folds on click', async () => {
    render(
      <CollapsibleSection title="Findings" count={3}>
        <p>the list</p>
      </CollapsibleSection>,
    )
    expect(screen.getByText('the list')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { expanded: true }))
    expect(screen.queryByText('the list')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()
  })

  /** A folded section still has to say there's work in it. */
  it('keeps the count visible while collapsed', async () => {
    render(
      <CollapsibleSection title="Findings" count={7}>
        <p>the list</p>
      </CollapsibleSection>,
    )
    await userEvent.click(screen.getByRole('button', { expanded: true }))
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText(/hidden/i)).toBeInTheDocument()
  })

  it('reports toggles to a controlling caller instead of self-managing', async () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <CollapsibleSection title="Findings" open onToggle={onToggle}>
        <p>the list</p>
      </CollapsibleSection>,
    )
    await userEvent.click(screen.getByRole('button', { expanded: true }))
    expect(onToggle).toHaveBeenCalledWith(false)

    // Controlled: it stays open until the caller says otherwise.
    expect(screen.getByText('the list')).toBeInTheDocument()
    rerender(
      <CollapsibleSection title="Findings" open={false} onToggle={onToggle}>
        <p>the list</p>
      </CollapsibleSection>,
    )
    expect(screen.queryByText('the list')).not.toBeInTheDocument()
  })

  /**
   * A "select all" nested inside the collapse control would fold the list every
   * time you used it, so actions sit outside the toggle button.
   */
  it('keeps header actions out of the toggle button', async () => {
    const onAction = vi.fn()
    const onToggle = vi.fn()
    render(
      <CollapsibleSection
        title="Rewrites"
        onToggle={onToggle}
        actions={<button onClick={onAction}>Select all</button>}
      >
        <p>the list</p>
      </CollapsibleSection>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(onAction).toHaveBeenCalled()
    expect(onToggle).not.toHaveBeenCalled()
    expect(screen.getByText('the list')).toBeInTheDocument()
  })

  it('hides the actions while collapsed — they act on a list you cannot see', async () => {
    render(
      <CollapsibleSection title="Rewrites" actions={<button>Select all</button>}>
        <p>the list</p>
      </CollapsibleSection>,
    )
    await userEvent.click(screen.getByRole('button', { expanded: true }))
    expect(screen.queryByRole('button', { name: 'Select all' })).not.toBeInTheDocument()
  })
})
