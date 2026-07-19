/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RegistryConflictNotice } from '../../src/components/RegistryConflictNotice'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'

describe('<RegistryConflictNotice>', () => {
  beforeEach(() => resetStore())

  it('renders nothing when there is no notice', () => {
    const { container } = render(<RegistryConflictNotice />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the notice text as a live status region', () => {
    useStore.getState().setRegistryNotice('"React" was renamed on another device')
    render(<RegistryConflictNotice />)
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('renamed on another device')
  })

  it('dismiss clears the notice', async () => {
    useStore.getState().setRegistryNotice('a shared entry changed elsewhere')
    render(<RegistryConflictNotice />)
    await userEvent.click(screen.getByRole('button', { name: /dismiss notice/i }))
    expect(useStore.getState().registryNotice).toBeNull()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
