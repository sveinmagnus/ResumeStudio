/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthGate } from '../../src/components/AuthGate'
import { UnauthorizedError } from '../../src/lib/api'

describe('<AuthGate>', () => {
  it('disables Connect until a token is entered', () => {
    render(<AuthGate onSubmit={vi.fn()} />)
    expect(screen.getByRole('button', { name: /connect/i })).toBeDisabled()
  })

  it('submits the entered token', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<AuthGate onSubmit={onSubmit} />)
    await userEvent.type(screen.getByPlaceholderText(/paste token/i), 'my-token')
    await userEvent.click(screen.getByRole('button', { name: /connect/i }))
    expect(onSubmit).toHaveBeenCalledWith('my-token')
  })

  it('shows an "incorrect token" message on UnauthorizedError', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new UnauthorizedError())
    render(<AuthGate onSubmit={onSubmit} />)
    await userEvent.type(screen.getByPlaceholderText(/paste token/i), 'bad')
    await userEvent.click(screen.getByRole('button', { name: /connect/i }))
    expect(await screen.findByText(/token is incorrect/i)).toBeInTheDocument()
  })

  it('shows a connection error for other failures', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('network'))
    render(<AuthGate onSubmit={onSubmit} />)
    await userEvent.type(screen.getByPlaceholderText(/paste token/i), 'x')
    await userEvent.click(screen.getByRole('button', { name: /connect/i }))
    expect(await screen.findByText(/could not connect/i)).toBeInTheDocument()
  })
})
