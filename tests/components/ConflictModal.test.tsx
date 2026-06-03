/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConflictModal } from '../../src/components/ConflictModal'
import { emptyStore, makeResume, makeProject } from '../fixtures'

const mine = () => ({ ...emptyStore(), resume: makeResume({ title: { en: 'Architect' } }) })
const theirs = () => {
  const s = { ...emptyStore(), resume: makeResume({ title: { en: 'Engineer' } }) }
  s.projects.push(makeProject({ id: 'srv-only', customer: { en: 'Initech' } }))
  return s
}

describe('<ConflictModal>', () => {
  it('shows the diff: a profile field change and a server-only section item', () => {
    render(<ConflictModal mine={mine()} theirs={theirs()} onResolve={() => {}} onClose={() => {}} />)
    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('Architect')).toBeInTheDocument()
    expect(screen.getByText('Engineer')).toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText(/only theirs/i)).toBeInTheDocument()
    // Item-level detail: the specific server-only project is named.
    expect(screen.getByText('Initech')).toBeInTheDocument()
  })

  it('calls onResolve("keep") from "Keep my version"', async () => {
    const onResolve = vi.fn()
    render(<ConflictModal mine={mine()} theirs={theirs()} onResolve={onResolve} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /keep my version/i }))
    expect(onResolve).toHaveBeenCalledWith('keep')
  })

  it('calls onResolve("discard") from "Discard mine"', async () => {
    const onResolve = vi.fn()
    render(<ConflictModal mine={mine()} theirs={theirs()} onResolve={onResolve} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /discard mine/i }))
    expect(onResolve).toHaveBeenCalledWith('discard')
  })

  it('closes (dismiss) via the X without resolving', async () => {
    const onResolve = vi.fn()
    const onClose = vi.fn()
    render(<ConflictModal mine={mine()} theirs={theirs()} onResolve={onResolve} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
    expect(onResolve).not.toHaveBeenCalled()
  })

  it('handles equivalent versions gracefully', () => {
    const same = mine()
    render(<ConflictModal mine={same} theirs={structuredClone(same)} onResolve={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/no field-level differences/i)).toBeInTheDocument()
  })
})
