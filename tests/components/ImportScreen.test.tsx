/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportScreen } from '../../src/components/ImportScreen'
import { resetStore } from '../helpers/store-reset'

describe('<ImportScreen>', () => {
  beforeEach(() => resetStore())

  it('renders the brand title and the drop zone in full-bleed mode', () => {
    render(<ImportScreen onStartFresh={() => {}} onImported={() => {}} />)
    expect(screen.getByText('Cartavio Resume Studio')).toBeInTheDocument()
    expect(screen.getByText(/drop your resume file here/i)).toBeInTheDocument()
  })

  it('hides the brand block in compact mode', () => {
    render(<ImportScreen compact onStartFresh={() => {}} onImported={() => {}} />)
    expect(screen.queryByText('Cartavio Resume Studio')).not.toBeInTheDocument()
    expect(screen.getByText(/drop your resume file here/i)).toBeInTheDocument()
  })

  it('"Start with an empty resume" calls onStartFresh', async () => {
    const onStartFresh = vi.fn()
    render(<ImportScreen onStartFresh={onStartFresh} onImported={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: /start with an empty resume/i }))
    expect(onStartFresh).toHaveBeenCalledTimes(1)
  })
})
