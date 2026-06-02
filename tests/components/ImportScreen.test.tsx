/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportScreen } from '../../src/components/ImportScreen'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'

describe('<ImportScreen>', () => {
  beforeEach(() => resetStore())

  it('renders the brand title and the drop zone', () => {
    render(<ImportScreen />)
    expect(screen.getByText('Cartavio Resume Studio')).toBeInTheDocument()
    expect(screen.getByText(/drop your resume file here/i)).toBeInTheDocument()
  })

  it('"Start with an empty resume" scaffolds a fresh resume', async () => {
    expect(useStore.getState().hasData).toBe(false)
    render(<ImportScreen />)
    await userEvent.click(screen.getByRole('button', { name: /start with an empty resume/i }))

    const s = useStore.getState()
    expect(s.hasData).toBe(true)
    expect(s.data.resume).not.toBeNull()
    expect(s.activeSection).toBe('header')
  })
})
