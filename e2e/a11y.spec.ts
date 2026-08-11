/**
 * Accessibility in a REAL browser — the half `tests/components/a11y.test.tsx`
 * structurally cannot cover.
 *
 * That suite runs axe under jsdom, which has no layout engine. Its own header
 * says so: colour-contrast is inert there. Anything that depends on rendered
 * geometry or on the real focus model — contrast ratios, target size, whether
 * a focus ring is actually reachable by Tab, whether the skip link works — is
 * simply not evaluated. Those are also the failures users report, because they
 * are the ones you cannot see by reading the markup.
 *
 * Two kinds of check live here:
 *   1. axe over the main routes, with real CSS applied.
 *   2. A keyboard-only journey. axe cannot tell you that a control is
 *      REACHABLE; it inspects a DOM snapshot, not a tab sequence.
 *
 * Scope is WCAG 2.1 A + AA, matching the level CLAUDE.md §6 claims for the
 * design tokens ("every ink ≥4.5:1"). This is the check that holds that claim
 * to account instead of taking it on trust.
 */
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createResume } from './helpers'

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/**
 * Reduced motion for every check here.
 *
 * axe measures COMPOSITED colour, so an element caught mid-fade reports the
 * blend rather than the real pair — the "Saved" pill reported #2c8656 on
 * #eaf8f0 (4.12:1) while its tokens are #1d7d49 on #e8f7ef (4.65:1). That is a
 * flaky failure about a colour the app never actually paints. The app collapses
 * transitions under reduced motion globally (index.css), so this measures the
 * settled state deterministically without changing any colour.
 */
test.use({ reducedMotion: 'reduce' })

/**
 * Run axe and return violations as readable lines.
 *
 * The default failure ("expected [] to equal [huge JSON blob]") is unusable —
 * a violation report you have to decode is one nobody acts on. This surfaces
 * rule id, impact, and the offending selector, which is enough to find it.
 */
async function violationsOn(page: Page, opts: { excludeIframes?: boolean } = {}): Promise<string[]> {
  // Let pending work settle first: a half-rendered card measures as a
  // half-rendered card, and reports colours the finished page never shows.
  await page.waitForLoadState('networkidle')
  let builder = new AxeBuilder({ page }).withTags(WCAG)
  if (opts.excludeIframes) builder = builder.exclude('iframe')
  const { violations } = await builder.analyze()
  return violations.flatMap((v) =>
    v.nodes.map((n) => `[${v.impact ?? 'n/a'}] ${v.id}: ${n.target.join(' ')} — ${v.help}`),
  )
}

test('the picker has no WCAG A/AA violations', async ({ page }) => {
  await createResume(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your resumes' })).toBeVisible()
  expect(await violationsOn(page)).toEqual([])
})

test('the editor shell and Personal Details have no WCAG A/AA violations', async ({ page }) => {
  await createResume(page)
  await page.getByRole('link', { name: 'Personal Details' }).click()
  await expect(page).toHaveURL(/\/header$/)
  expect(await violationsOn(page)).toEqual([])
})

test('an expanded Projects card has no WCAG A/AA violations', async ({ page }) => {
  await createResume(page)
  await page.getByRole('link', { name: /^Projects/ }).click()
  // An empty section proves little — the card is where the form controls are.
  await page.getByRole('button', { name: /Add project/i }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  expect(await violationsOn(page)).toEqual([])
})

test('the Resume Views editor has no WCAG A/AA violations', async ({ page }) => {
  // The heaviest page in the app: a live-preview iframe re-rendering beside a
  // long form. axe walks both trees, which does not fit the default budget.
  test.setTimeout(90_000)
  await createResume(page)
  await page.getByRole('link', { name: /Resume Views/ }).click()
  await page.getByRole('button', { name: 'New View' }).click()
  // The preview iframe renders EXPORT markup from a different code path
  // (viewFilter/buildViewHtml) with the user's chosen view fonts and colours —
  // a document, not app chrome. Its escaping is covered by viewFilter's
  // security suites; folding its findings in here would report the editor as
  // broken for a colour the USER picked for their own CV.
  expect(await violationsOn(page, { excludeIframes: true })).toEqual([])
})

/**
 * Keyboard-only reachability.
 *
 * The skip link is the first thing a keyboard user meets and the easiest to
 * break invisibly: it is visually hidden until focused, so a mouse user never
 * sees it and no screenshot shows it missing.
 */
test('the skip link is the first tab stop and moves focus into the content', async ({ page }) => {
  await createResume(page)
  await page.keyboard.press('Tab')

  const first = page.locator(':focus')
  await expect(first).toHaveText(/skip/i)

  await first.press('Enter')
  // Focus must land somewhere inside the main region — not stay on the link,
  // which is what a skip link that points at a missing id does.
  const landedInMain = await page.evaluate(() => {
    const el = document.activeElement
    return !!el && !!el.closest('main')
  })
  expect(landedInMain).toBe(true)
})

test('a section can be reached and edited with the keyboard alone', async ({ page }) => {
  await createResume(page)
  await page.getByRole('link', { name: 'Personal Details' }).click()
  await expect(page).toHaveURL(/\/header$/)

  // Tab until the full-name input has focus, then type into it — no clicks.
  const fullName = page.getByLabel('Full name', { exact: true })
  let reached = false
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = await fullName.evaluate((el) => el === document.activeElement)
  }
  expect(reached, 'the name field was not reachable by Tab within 60 stops').toBe(true)

  await page.keyboard.type('Keyboard Only')
  await expect(fullName).toHaveValue('Keyboard Only')
  // And the edit persists through the normal auto-save path.
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })
})

/**
 * Every focusable control must SHOW focus. A ring removed by an `outline: none`
 * somewhere is invisible to axe (it inspects the DOM, not computed focus
 * styles) and invisible in review, but it is the difference between a usable
 * keyboard journey and guessing where you are.
 */
test('focused controls have a visible focus indicator', async ({ page }) => {
  await createResume(page)
  await page.getByRole('link', { name: 'Personal Details' }).click()

  const invisible: string[] = []
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const s = getComputedStyle(el)
      const hasRing =
        (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
        s.boxShadow !== 'none'
      return { hasRing, tag: el.tagName.toLowerCase(), cls: el.className || '' }
    })
    if (info && !info.hasRing) invisible.push(`${info.tag}.${String(info.cls).slice(0, 40)}`)
  }
  expect(invisible).toEqual([])
})
