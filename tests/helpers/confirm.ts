import { waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Drive the app's promise-based confirm dialog (src/components/ui/ConfirmDialog).
 * It self-portals into document.body, so tests wait for it to appear, click the
 * confirm or cancel button, and wait for it to tear down.
 */
export async function resolveConfirm(choice: 'confirm' | 'cancel'): Promise<void> {
  const sel = choice === 'confirm' ? '.confirm-ok' : '.confirm-cancel'
  const btn = await waitFor(() => {
    const el = document.querySelector<HTMLButtonElement>(sel)
    if (!el) throw new Error('confirm dialog did not appear')
    return el
  })
  await userEvent.click(btn)
  // The dialog defers its unmount by a tick; wait until it's gone so the next
  // interaction doesn't collide with a stale overlay.
  await waitFor(() => {
    if (document.querySelector('.confirm-modal')) throw new Error('confirm dialog still open')
  })
}

/** True while a confirm dialog is on screen (for "was it even shown?" assertions). */
export function confirmDialogVisible(): boolean {
  return !!document.querySelector('.confirm-modal')
}
