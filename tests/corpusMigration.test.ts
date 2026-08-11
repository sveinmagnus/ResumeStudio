/**
 * @vitest-environment jsdom
 *
 * The migration chain, rehearsed against REAL exports.
 *
 * `migrate.test.ts` builds stores in code and stamps `shape_version` on them.
 * That proves each migration does what it says on data shaped the way the test
 * author imagined. It cannot prove the thing a 1.0.0 actually promises — that
 * a CV written by an older build still opens — because the fixtures were
 * written by the same person, on the same day, as the migration.
 *
 * This reads genuine exports from `corpus/`, which is gitignored: every file
 * there is one identified person's CV and must never enter the repository.
 * The suite therefore SKIPS when the directory is empty, which is the normal
 * state in CI and on a fresh clone. Point `RESUME_CORPUS_DIR` at a directory
 * of real exports to run it.
 *
 * Nothing here asserts on personal content — only on counts, structure and
 * shape. A failure names a section and an index, never a person.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { migrateStore, CURRENT_SHAPE_VERSION } from '../src/lib/migrate'
import { parseStoreBackup } from '../server/backup'
import { importFromCVPartner, isCVPartnerFormat } from '../src/lib/importer'
import { applyView, buildViewHtml, buildViewSections } from '../src/lib/viewFilter'
import { buildViewText } from '../src/lib/viewText'
import { withHeaderDefaults, withFooterDefaults } from '../src/lib/viewHeader'
import { DEFAULT_VIEW_STYLE, deriveTokens } from '../src/lib/viewStyle'
import { makeView } from './fixtures'
import type { ResumeStore } from '../src/types'

const CORPUS = process.env.RESUME_CORPUS_DIR ?? path.join(process.cwd(), 'corpus')

function corpusFiles(): string[] {
  try {
    return fs.readdirSync(CORPUS).filter((f) => f.toLowerCase().endsWith('.json')).sort()
  } catch {
    return []
  }
}

const files = corpusFiles()
const hasCorpus = files.length > 0

/**
 * Sections a migration deliberately CONSUMES: the content moves and the key is
 * dropped. Paired with the destination, so the test asserts the content
 * arrived rather than merely tolerating a section going to zero — which is
 * what a naive "nothing shrank" check would have to do, and would then miss a
 * migration that dropped the data on the floor.
 */
interface Consumed {
  destination: string
  /** How many of the source items are expected to survive the move. */
  expected: (items: unknown[]) => number
}

const CONSUMED_BY: Record<string, Consumed> = {
  // v6 unifyShowcaseCategories: the Skills Showcase folded into the skill
  // registry's own categories. DISABLED groups are dropped rather than
  // carried, deliberately — they were invisible in every export before the
  // unification, so there was nothing to preserve. The real corpus is what
  // exercises this: 12 groups in, 2 of them disabled, 10 categories out.
  technology_categories: {
    destination: 'skill_categories',
    expected: (items) => items.filter((i) => !(i as { disabled?: boolean })?.disabled).length,
  },
}

/** Every array-valued section on the store, discovered rather than listed. */
function sectionCounts(store: ResumeStore): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(store)) {
    if (Array.isArray(value)) out[key] = value.length
  }
  return out
}

/** Each resume in a file, whatever envelope it arrived in. */
interface Loaded { file: string; label: string; store: ResumeStore; sourceShape: number }

function loadAll(): Loaded[] {
  const out: Loaded[] = []
  for (const file of files) {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(CORPUS, file), 'utf8'))

    // A CVpartner export is not a backup — it goes through the importer, which
    // is itself a path a real user takes on day one.
    if (isCVPartnerFormat(raw)) {
      out.push({ file, label: 'cvpartner-import', store: importFromCVPartner(raw), sourceShape: 0 })
      continue
    }

    // The legacy combined backup, read through the SHIPPED parser rather than
    // by reaching into the JSON — the envelope is part of what has to keep
    // working, and it is the format an existing sync folder still holds.
    const entries = parseStoreBackup(raw)
    entries.forEach((entry, i) => {
      const store = entry.data as ResumeStore
      out.push({
        file,
        label: `resume ${i + 1}`,
        store,
        sourceShape: store.shape_version ?? 1,
      })
    })
  }
  return out
}

describe.skipIf(!hasCorpus)('migration rehearsal on real exports', () => {
  const loaded = hasCorpus ? loadAll() : []

  it('the corpus actually spans old shapes (otherwise it proves nothing)', () => {
    const shapes = loaded.map((l) => l.sourceShape)
    expect(loaded.length).toBeGreaterThan(0)
    // At least one file must predate the current shape, or this suite is
    // asserting that current data is current.
    expect(Math.min(...shapes)).toBeLessThan(CURRENT_SHAPE_VERSION)
  })

  for (const { file, label, store, sourceShape } of loaded) {
    describe(`${file} — ${label} (shape ${sourceShape || 'n/a'})`, () => {
      const before = sectionCounts(store)
      const migrated = migrateStore(store)

      it('reaches the current shape', () => {
        expect(migrated.shape_version).toBe(CURRENT_SHAPE_VERSION)
      })

      it('loses no items — including the sections a migration consumes', () => {
        const after = sectionCounts(migrated)
        for (const [section, count] of Object.entries(before)) {
          const consumed = CONSUMED_BY[section]
          if (consumed) {
            // The source is expected to disappear; what must not disappear is
            // the content it was supposed to carry. Assert against the
            // DESTINATION, using the migration's own survival rule.
            const want = consumed.expected((store as unknown as Record<string, unknown[]>)[section] ?? [])
            expect(after[section] ?? 0, `${section} should be consumed`).toBe(0)
            expect(
              after[consumed.destination] ?? 0,
              `${want} of ${count} ${section} should have reached ${consumed.destination}`,
            ).toBeGreaterThanOrEqual(want)
            continue
          }
          // Migrations may ADD sections (a new array defaulted in) but must
          // never drop entries from one that already had them.
          expect(after[section] ?? 0, `${section} shrank`).toBeGreaterThanOrEqual(count)
        }
      })

      it('is idempotent — migrating twice changes nothing', () => {
        expect(migrateStore(structuredClone(migrated))).toEqual(migrated)
      })

      it('gives every item a unique id within its section', () => {
        for (const [section, value] of Object.entries(migrated)) {
          if (!Array.isArray(value)) continue
          const ids = value
            .filter((v): v is { id: string } => !!v && typeof v === 'object' && 'id' in v)
            .map((v) => v.id)
          expect(new Set(ids).size, `${section} has duplicate ids`).toBe(ids.length)
        }
      })

      /**
       * Both migrations deliberately LEAVE the deprecated field in place — it
       * round-trips harmlessly and keeps the importers unchanged. So the thing
       * worth asserting is not that the old key vanished (it does not) but
       * that the DATE SURVIVED into the range, which is what the editor and
       * every exporter now read.
       */
      it('carried the legacy dates into the new ranges (v11 courses, v13 presentations)', () => {
        for (const [i, course] of (migrated.courses ?? []).entries()) {
          const c = course as unknown as Record<string, unknown>
          expect('end' in c, `courses[${i}] has no end`).toBe(true)
          if (c.completed) {
            expect(c.end, `courses[${i}] lost its completed date`).toEqual(c.completed)
          }
        }
        for (const [i, pres] of (migrated.presentations ?? []).entries()) {
          const p = pres as unknown as Record<string, unknown>
          expect('end' in p, `presentations[${i}] has no end`).toBe(true)
          if (p.date) {
            expect(p.end, `presentations[${i}] lost its date`).toEqual(p.date)
          }
        }
      })

      it('completed the competency-bundle migration (v12) with resolvable ids', () => {
        const known = new Set((migrated.key_competencies ?? []).map((c) => c.id))
        for (const [i, profile] of (migrated.key_qualifications ?? []).entries()) {
          const ids = profile.competency_ids
          expect(Array.isArray(ids), `key_qualifications[${i}].competency_ids missing`).toBe(true)
          for (const id of ids ?? []) {
            // A dangling id would render a bundle shorter than the editor shows.
            expect(known.has(id), `key_qualifications[${i}] references unknown competency`).toBe(true)
          }
        }
      })

      it('renders end-to-end after migration — the actual promise', () => {
        // "Your CV still opens" is not a shape assertion; it is this. A store
        // that migrates cleanly and then throws in a render adapter has still
        // lost the user their document.
        const view = makeView({ sections: buildViewSections() })
        const locale = migrated.resume?.supported_locales?.[0] ?? 'en'

        const filtered = applyView(migrated, view)
        expect(filtered).toBeTruthy()

        const html = buildViewHtml(migrated, view, locale, {
          header: withHeaderDefaults(view.header),
          footer: withFooterDefaults(view.footer),
          tokens: deriveTokens(DEFAULT_VIEW_STYLE),
        })
        expect(html.length).toBeGreaterThan(500)
        // The tell-tale of a field the renderer reached for and did not find.
        expect(html).not.toContain('undefined')
        expect(html).not.toContain('[object Object]')

        const text = buildViewText(migrated, view, locale, 'text')
        expect(text.length).toBeGreaterThan(200)
        expect(text).not.toContain('undefined')
      })
    })
  }
})

describe.skipIf(hasCorpus)('migration rehearsal (skipped)', () => {
  it('records why it did not run', () => {
    // Present so a skipped run is visible as a deliberate skip rather than as
    // a suite that silently contains nothing.
    expect(files).toEqual([])
  })
})
