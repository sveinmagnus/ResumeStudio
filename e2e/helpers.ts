import { expect, type Page } from '@playwright/test'

/**
 * Create a resume from `/` (fresh-install screen OR picker list) → editor.
 *
 * The suite runs serially against one in-memory DB, so `/` is the fresh-install
 * import screen until a resume exists and the picker list afterwards. Handling
 * both here is what lets each spec stand alone regardless of run order.
 */
export async function createResume(page: Page): Promise<void> {
  await page.goto('/')
  const addBtn = page.getByRole('button', { name: 'Add resume' })
  const startFresh = page.getByRole('button', { name: 'Start with an empty resume' })
  await expect(addBtn.or(startFresh)).toBeVisible()
  // The list view needs its add panel opened first; the empty state does not.
  if (await addBtn.isVisible()) await addBtn.click()
  await startFresh.click()
  await page.waitForURL(/\/r\/[0-9a-f-]{36}/)
}
