/**
 * Signing out, in the one place that knows what it has to take with it.
 *
 * Ending the session is the easy half. The half that matters is
 * `clearAllCaches()`: the per-resume localStorage fallback holds a PLAINTEXT
 * CV, and multi-user makes a shared machine more likely, not less — so a
 * logout that leaves it behind hands the next person at the keyboard somebody
 * else's resume.
 *
 * The guard in front of it is the other half. Clearing the caches also discards
 * any edits still queued for a server that has not had them yet, so an unsynced
 * queue is named before anything is thrown away and the user can back out to
 * export a backup first.
 */
import { api } from '../../lib/api'
import { clearAllCaches, listDirty } from '../../lib/localCache'
import { confirmDialog } from './ConfirmDialog'

/**
 * End the session and wipe the local plaintext caches. Resolves to false when
 * the user declined the unsynced-work warning, in which case nothing happened.
 */
export async function signOut(): Promise<boolean> {
  const dirty = listDirty().length
  if (dirty > 0) {
    const ok = await confirmDialog({
      title: 'Sign out with unsynced changes?',
      message:
        `${dirty} resume(s) still have changes this browser has not sent to the server. ` +
        `Signing out deletes the local copies — export a backup first if unsure.`,
      confirmLabel: 'Sign out anyway',
      danger: true,
    })
    if (!ok) return false
  }
  await api.logout()
  clearAllCaches()
  return true
}
