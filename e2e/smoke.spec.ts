import { test, expect, type Page } from '@playwright/test'

/**
 * Smoke flows against the real production server (see playwright.config.ts).
 * These catch the integration class of regression — wiring, routing, CSP,
 * lazy chunks — that unit/component/route tests can't. Keep this suite thin:
 * happy paths only, behavior detail lives in the Vitest suites.
 *
 * The suite runs serially against one in-memory DB. An empty server shows the
 * fresh-install import screen at `/`; once a resume exists, `/` is the picker
 * list — the helper handles both so each test stands alone.
 */

/** Create a resume from `/` (fresh-install screen OR picker list) → editor. */
async function createResume(page: Page): Promise<void> {
  await page.goto('/')
  const addBtn = page.getByRole('button', { name: 'Add resume' })
  const startFresh = page.getByRole('button', { name: 'Start with an empty resume' })
  await expect(addBtn.or(startFresh)).toBeVisible()
  if (await addBtn.isVisible()) await addBtn.click() // open the add panel on the list view
  await startFresh.click()
  await page.waitForURL(/\/r\/[0-9a-f-]{36}/)
}

test('fresh install screen creates the first resume; picker lists it', async ({ page }) => {
  await createResume(page)
  // The editor shell is up: sidebar navigation present.
  await expect(page.getByText('Personal Details')).toBeVisible()

  // Back on `/`, the fresh-install screen has become the picker list.
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your resumes' })).toBeVisible()
})

// TextField labels aren't programmatically associated with their inputs
// (no htmlFor/id — flagged under the roadmap A8 accessibility item), so
// getByLabel can't reach them; locate through the field wrapper instead.
const fullName = (page: Page) =>
  page.locator('.pf-wrap', { has: page.locator('label:text-is("Full name")') }).locator('input')

test('an edit auto-saves to the server and survives a reload', async ({ page }) => {
  await createResume(page)

  await page.getByText('Personal Details').click()
  await fullName(page).fill('Kari Nordmann')
  // Auto-save: 1s debounce + PUT round-trip → header shows "Saved".
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })

  await page.reload()
  await page.getByText('Personal Details').click()
  await expect(fullName(page)).toHaveValue('Kari Nordmann')
})

test('a Resume View renders the live preview from saved content', async ({ page }) => {
  await createResume(page)

  // Give the CV some content the preview can show.
  await page.getByText('Personal Details').click()
  await fullName(page).fill('Preview Person')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })

  await page.getByText('Resume Views').click()
  await page.getByRole('button', { name: 'New View' }).click()

  // The live preview iframe re-renders (250ms debounce) with the CV content.
  const frame = page.frameLocator('iframe[title="Resume View preview"]')
  await expect(frame.getByText('Preview Person')).toBeVisible({ timeout: 10_000 })
})

test('unknown resume ids bounce back to the picker', async ({ page }) => {
  await page.goto('/r/00000000-0000-0000-0000-000000000000')
  await page.waitForURL((url) => !url.pathname.startsWith('/r/'), { timeout: 10_000 })
  // Either picker state qualifies — list ("Your resumes") or fresh install.
  await expect(
    page.getByRole('heading', { name: /Your resumes|Cartavio Resume Studio/ }),
  ).toBeVisible()
})
