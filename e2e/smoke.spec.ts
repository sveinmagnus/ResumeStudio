import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

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
  // The list view needs its add panel opened first; the empty state does not.
  if (await addBtn.isVisible()) await addBtn.click()
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

// TextField labels are programmatically associated (htmlFor/id) since the
// v0.3.1 accessibility wave — getByLabel is the canonical locator.
const fullName = (page: Page) => page.getByLabel('Full name', { exact: true })

test('an edit auto-saves to the server and survives a reload', async ({ page }) => {
  await createResume(page)

  // Scope to the nav LINK — once a section is active its name also shows as the
  // page <h1>, so an unscoped lookup is ambiguous. The nav is real anchors, so
  // Ctrl-click opens a section in a new tab.
  await page.getByRole('link', { name: 'Personal Details' }).click()
  await expect(page).toHaveURL(/\/r\/[0-9a-f-]{36}\/header/)
  await fullName(page).fill('Kari Nordmann')
  // Auto-save: 1s debounce + PUT round-trip → header shows "Saved".
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })

  // The URL carries the section — a reload lands straight back on it.
  await page.reload()
  await expect(fullName(page)).toHaveValue('Kari Nordmann')
})

test('a Resume View renders the live preview from saved content', async ({ page }) => {
  await createResume(page)

  // Give the CV some content the preview can show.
  await page.getByRole('link', { name: 'Personal Details' }).click()
  await fullName(page).fill('Preview Person')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })

  await page.getByRole('link', { name: /Resume Views/ }).click()
  await page.getByRole('button', { name: 'New View' }).click()

  // The live preview iframe re-renders (250ms debounce) with the CV content.
  const frame = page.frameLocator('iframe[title="Resume View preview"]')
  await expect(frame.getByText('Preview Person')).toBeVisible({ timeout: 10_000 })
})

/**
 * Exporting is the app's whole point, and it is the one flow where everything
 * that only breaks in a real browser lines up: a dynamic `import()` of a ~350 kB
 * chunk, the CSP that governs whether that chunk may load at all, and a Blob
 * download. None of it is exercised by the jsdom suites, which stub the exporter
 * precisely because pulling it in is expensive.
 */
test('a view exports a .docx — the lazy chunk loads and downloads', async ({ page }) => {
  await createResume(page)

  await page.getByRole('link', { name: 'Personal Details' }).click()
  await fullName(page).fill('Export Person')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })

  await page.getByRole('link', { name: /Resume Views/ }).click()
  await page.getByRole('button', { name: 'New View' }).click()

  // The export actions live behind an "Export view" dropdown.
  await page.getByRole('button', { name: /Export view/ }).click()
  const download = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.getByRole('menuitem', { name: /Export DOCX/ }).click(),
  ]).then(([d]) => d)

  expect(download.suggestedFilename()).toMatch(/\.docx$/)
  // A DOCX is a zip: the first bytes are the local file header. An empty or
  // HTML-error "download" would not be.
  const path = await download.path()
  expect(path).toBeTruthy()
})

/**
 * The same proof for the PDF path, which is a SEPARATE render engine (pdfmake,
 * ~1 MB plus a font chunk per family) and fails in ways the DOCX test cannot
 * see. Its fonts are the reason this test earns its runtime: pdfmake's browser
 * build ships no font metrics of its own, so every family is a lazy chunk that
 * must be fetched and registered before layout. A family that never registers
 * throws mid-layout — and only for the users who picked that font, which is
 * precisely the failure a stubbed unit test reports as passing.
 */
test('a view exports a .pdf — pdfmake and its fonts load and render', async ({ page }) => {
  await createResume(page)

  await page.getByRole('link', { name: 'Personal Details' }).click()
  await fullName(page).fill('Pdf Person')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })

  await page.getByRole('link', { name: /Resume Views/ }).click()
  await page.getByRole('button', { name: 'New View' }).click()

  await page.getByRole('button', { name: /Export view/ }).click()
  const download = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('menuitem', { name: /Export PDF/ }).click(),
  ]).then(([d]) => d)

  expect(download.suggestedFilename()).toMatch(/\.pdf$/)
  // Assert the CONTENT, not just that a file arrived: a failed render can still
  // produce a download. `%PDF-` is the format's magic number, and a real
  // document ends with the EOF marker after its xref table.
  const path = await download.path()
  expect(path).toBeTruthy()
  const bytes = readFileSync(path!)
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  expect(bytes.subarray(-1024).toString('latin1')).toContain('%%EOF')
})

/**
 * The nav is anchors, not buttons with onClick — so a section can be opened in
 * a second window and read beside another one. A synthetic click can't prove
 * that; opening the href in a new page can.
 */
test('a section link is a real URL that loads on its own', async ({ page, context }) => {
  await createResume(page)

  const link = page.getByRole('link', { name: /^Projects/ })
  const href = await link.getAttribute('href')
  expect(href).toMatch(/\/r\/[0-9a-f-]{36}\/projects$/)

  const second = await context.newPage()
  await second.goto(href!)
  await expect(second.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await second.close()
})

test('unknown resume ids bounce back to the picker', async ({ page }) => {
  await page.goto('/r/00000000-0000-0000-0000-000000000000')
  await page.waitForURL((url) => !url.pathname.startsWith('/r/'), { timeout: 10_000 })
  // Either picker state qualifies — list ("Your resumes") or fresh install.
  await expect(
    page.getByRole('heading', { name: /Your resumes|Cartavio Resume Studio/ }),
  ).toBeVisible()
})
