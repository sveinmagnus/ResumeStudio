/**
 * @vitest-environment jsdom
 *
 * What a realistic large CV actually weighs and costs.
 *
 * `src/lib/storage.ts` classifies payload weight against two thresholds, and
 * `plans/open-items.md` defers the content-addressed asset table until "the
 * picker actually warns on real data". Both were written from reasoning about
 * the shape of the data, and neither had ever been run against a CV the size
 * of a real one — so the trigger condition could only ever fire in production.
 * This measures it in CI instead.
 *
 * The assertions are BUDGETS, not targets: each sits far enough above today's
 * measurement to ignore noise, and close enough to fail on a real regression —
 * an image accidentally duplicated per locale, prose copied into every one of
 * the 15 locales at export time, a view filter that stops filtering. When one
 * fails, read the number it prints before changing it: a budget quietly raised
 * to green a build is the one change that makes this file worthless.
 */
import { describe, it, expect } from 'vitest'
import { makeLargeStore, storeBytes, ALL_LOCALES, fakeImage } from './helpers/largeStore'
import { LARGE_RESUME_BYTES, RISK_RESUME_BYTES, weightLevel } from '../src/lib/storage'
import { applyView, buildViewHtml } from '../src/lib/viewFilter'
import { buildViewSections } from '../src/lib/viewFilter'
import { buildViewText } from '../src/lib/viewText'
import { searchStore } from '../src/lib/contentSearch'
import { makeView } from './fixtures'

const MB = 1_000_000
const fullView = () => makeView({ sections: buildViewSections() })

/** Report shape: `expect` failures print the measured number, not just a diff. */
function within(actual: number, budget: number, what: string): void {
  expect(actual, `${what}: measured ${actual}, budget ${budget}`).toBeLessThan(budget)
}

describe('a realistic large CV — payload weight', () => {
  it('50 projects x 15 locales with a photo stays under the offline-queue risk line', () => {
    const store = makeLargeStore()
    const bytes = storeBytes(store)

    // The number that matters: above RISK_RESUME_BYTES (2.5 MB) the offline
    // queue is at genuine localStorage-quota risk, because the pending record
    // mirrors the whole document including its base64 images.
    within(bytes, RISK_RESUME_BYTES, 'large CV payload')

    // And it IS heavy enough to be worth watching — if this ever drops below
    // the "large" line the fixture stopped being realistic, and the budget
    // above stopped meaning anything.
    expect(bytes).toBeGreaterThan(LARGE_RESUME_BYTES)
    expect(weightLevel(bytes)).toBe('large')
  })

  it('images dominate the payload, which is what the asset table would fix', () => {
    const withImages = storeBytes(makeLargeStore())
    const without = storeBytes(makeLargeStore({ photoKb: 0 }))
    const imageShare = (withImages - without) / withImages

    // Not an arbitrary assertion: this ratio IS the argument for the deferred
    // content-addressed asset table. If prose ever outweighs images at this
    // size, that plan's cost/benefit has changed and it should be re-read.
    expect(imageShare).toBeGreaterThan(0.1)
    // Text alone must stay modest — 50 projects of two-language prose is not
    // what threatens the quota.
    within(without, MB, 'text-only payload')
  })

  // Snapshot weight is asserted where the stripping actually happens —
  // `stripSnapshotImages` is private to server/db.ts, so testing it here would
  // mean re-implementing it and proving only that the copy agrees with itself.
  // See tests/server/scale.test.ts.
})

describe('a realistic large CV — render cost', () => {
  const store = makeLargeStore()
  const view = fullView()

  it('applyView filters the whole document quickly', () => {
    const t0 = performance.now()
    const filtered = applyView(store, view)
    const ms = performance.now() - t0
    expect(filtered.projects.length).toBe(50)
    // This runs on every keystroke-debounced preview refresh, so it is the one
    // path where a quadratic lookup would be felt directly by the user.
    within(ms, 400, 'applyView ms')
  })

  it('builds the preview HTML within the preview debounce budget', () => {
    const t0 = performance.now()
    const html = buildViewHtml(store, view, 'en')
    const ms = performance.now() - t0
    expect(html).toContain('Customer 0')
    // The live preview re-renders on a 250 ms debounce. Slower than the
    // debounce means the preview is permanently chasing the editor.
    within(ms, 1500, 'buildViewHtml ms')
  })

  it('builds the ATS text export without blowing up', () => {
    const t0 = performance.now()
    const text = buildViewText(store, view, 'en')
    within(performance.now() - t0, 1500, 'buildViewText ms')
    expect(text.length).toBeGreaterThan(1000)
  })

  it('global search stays interactive across the whole document', () => {
    const t0 = performance.now()
    const hits = searchStore(store, 'Customer 4', 'en')
    const ms = performance.now() - t0
    expect(hits.length).toBeGreaterThan(0)
    // Ctrl+K search runs per keystroke — this is a typing latency budget.
    within(ms, 250, 'searchContent ms')
  })
})

describe('the fixture itself', () => {
  it('fills every offered locale, so multi-language weight is really measured', () => {
    const store = makeLargeStore()
    const project = store.projects[0]
    for (const locale of ALL_LOCALES) {
      expect(project.description[locale], `missing ${locale}`).toBeTruthy()
    }
  })

  it('produces images of about the requested size', () => {
    // Guards the generator: a fake image that is actually 40 bytes would make
    // every weight assertion above pass for the wrong reason.
    const bytes = new TextEncoder().encode(fakeImage(300)).length
    expect(bytes).toBeGreaterThan(280 * 1024)
    expect(bytes).toBeLessThan(440 * 1024)
  })
})
