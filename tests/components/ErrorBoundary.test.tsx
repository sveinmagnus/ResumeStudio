/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBoundary } from '../../src/components/ErrorBoundary'

function Bomb({ boom }: { boom: boolean }) {
  if (boom) throw new Error('kaboom')
  return <div>safe child</div>
}

describe('<ErrorBoundary>', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => vi.restoreAllMocks())

  it('renders children when nothing throws', () => {
    render(<ErrorBoundary><Bomb boom={false} /></ErrorBoundary>)
    expect(screen.getByText('safe child')).toBeInTheDocument()
  })

  it('shows the fallback (with the error message) when a child throws', () => {
    render(<ErrorBoundary><Bomb boom /></ErrorBoundary>)
    expect(screen.getByText(/this section crashed/i)).toBeInTheDocument()
    expect(screen.getByText('kaboom')).toBeInTheDocument()
  })

  it('resets when resetKey changes', () => {
    const { rerender } = render(<ErrorBoundary resetKey="a"><Bomb boom /></ErrorBoundary>)
    expect(screen.getByText(/this section crashed/i)).toBeInTheDocument()
    rerender(<ErrorBoundary resetKey="b"><Bomb boom={false} /></ErrorBoundary>)
    expect(screen.getByText('safe child')).toBeInTheDocument()
  })

  it('recovers via the "Try again" button', async () => {
    let boom = true
    const Toggle = () => {
      if (boom) throw new Error('x')
      return <div>recovered</div>
    }
    render(<ErrorBoundary><Toggle /></ErrorBoundary>)
    expect(screen.getByText(/this section crashed/i)).toBeInTheDocument()
    boom = false
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(screen.getByText('recovered')).toBeInTheDocument()
  })
})
