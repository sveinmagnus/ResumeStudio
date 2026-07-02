/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { confirmDialog } from '../../src/components/ui/ConfirmDialog'
import { resolveConfirm } from '../helpers/confirm'

describe('confirmDialog()', () => {
  it('resolves true when confirmed and false when cancelled', async () => {
    const yes = confirmDialog({ message: 'Do it?' })
    await resolveConfirm('confirm')
    expect(await yes).toBe(true)

    const no = confirmDialog({ message: 'Do it?' })
    await resolveConfirm('cancel')
    expect(await no).toBe(false)
  })

  it('renders the title, message, custom labels and an undo hint', async () => {
    const p = confirmDialog({
      title: 'Delete item?', message: 'This removes it.',
      confirmLabel: 'Delete', undoHint: true,
    })
    expect(await screen.findByText('Delete item?')).toBeInTheDocument()
    expect(screen.getByText(/This removes it\. You can undo this with Ctrl\+Z\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    await resolveConfirm('confirm')
    expect(await p).toBe(true)
  })

  it('closes as a cancel on Escape', async () => {
    const p = confirmDialog({ message: 'Do it?' })
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    expect(await p).toBe(false)
    await waitFor(() => expect(document.querySelector('.confirm-modal')).toBeNull())
  })
})
