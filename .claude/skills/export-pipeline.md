---
name: export-pipeline
description: How Resume Studio renders a Resume View — HTML preview, one-click PDF (pdfmake), DOCX, and ATS text/Markdown — and the rules that keep the paths in agreement. Use before changing src/lib/viewFilter.ts, src/lib/pdfExporter.ts, src/lib/exporter.ts, src/lib/viewText.ts, the live preview, or the Export controls in ViewEditor — or when adding a section/field to exports. Covers the section-descriptor catalog, render-path parity, the lazy-load discipline, the `italics` gotcha, and the escaping cross-check.
---

# Export pipeline (HTML preview, PDF, DOCX, text/Markdown)

A Resume View is exported through **independent render paths** that must stay
visually and structurally in agreement. The whole class of export bugs is
"changed one path, forgot the other." Read this before touching any renderer
or the export UI. Pairs with CLAUDE.md §7 (adding a section) and the
security-review skill (escaping).

## 1. The render paths (keep them in sync)

All consume the **filtered** store from `applyView(store, view)` (drops hidden
sections, excluded items, and — if set — non-starred items). Then:

- **HTML** → `viewFilter.ts → buildViewHtml()` builds an HTML string, rendered
  two ways: the live preview pane (`<iframe srcDoc={previewHtml}>` in
  `ViewEditor`) and an optional pop-out preview window (`win.document.write`,
  kept in sync while it's open).
- **PDF** → `pdfExporter.ts → exportPdf()` builds a pdfmake document — a
  one-click vector `.pdf` download, no print dialog. Its own render engine, so
  it ~matches (not pixel-identical to) the HTML preview.
- **DOCX** → `exporter.ts → exportDocx()` builds a `docx` `Document`.
- **Text / Markdown** → `viewText.ts → buildViewText()` / `buildViewMarkdown()`
  for ATS-safe plain formats.
- **Europass XML** → `exporterEuropass.ts → exportEuropassXml()` emits a
  `SkillsPassport` document, the round-trip partner of `importerEuropass.ts`.
  It is a **targeted-format** path, NOT a general render path: Europass only
  models identity / work / education / languages, so it deliberately covers
  just those and does not read the section catalog. Don't "fix" that by
  mapping projects/courses onto `<WorkExperience>` — it would misrepresent
  them and break the import round-trip. It builds a **DOM tree serialized by
  XMLSerializer**, never XML strings, so escaping is structural (see the
  security note in the file); its regression net is the export→import
  round-trip in `tests/exporterEuropass.test.ts`.

Every full render path (plus one more consumer — `getItemTitle` /
`getItemSubtitle` in `viewFilter.ts`, which feed the View-editor's item-toggle
list) is driven by a **single section-descriptor catalog**
(`lib/sectionCatalog.ts`, one descriptor per section with `summary()` /
`full()` data views returning **data only**). The per-path adapters own
escaping and layout — there are no per-section switch statements left. So
"support a section in exports" means **adding one descriptor**, not editing
four renderers. Per-path differences go behind `ctx.target`. See CLAUDE.md §7
step 7. (Europass is the exception — a fixed external schema, not the catalog.)

**Rule:** if a section/field renders in one *catalog-driven* path, it renders
in the others (or there's a deliberate, commented reason it doesn't — e.g. the
`skills`/`roles` *registries* are intentionally never exported as their own
sections). Europass is exempt by design — its schema, not our catalog, decides
what it carries.

**Rule: no English literal in a render path.** Anything the *app* supplies
around the user's content is chrome, and chrome is localized — it lands in a
file a client reads. Take the word from `lib/exportStrings.ts` (`xs` / `xt` /
`fmtYears`) or from the vocabulary's own home: months + "Present"
(`lib/locales.ts`), section headings (`lib/sections.ts`), CEFR words
(`lib/cefr.ts`), header field labels (`lib/viewHeader.ts`), and the
publication / position / relationship label sets. Never hardcode `'Skills: '`
or `` `${n} yrs` `` inline — that class of literal is exactly what left the app
offering 19 languages while translating 4, and it fails silently because
`resolve()` falls back to English rather than throwing. `tests/localeCoverage.
test.ts` pins every surface against every offered locale; a new locale fails the
suite until it is translated everywhere. Note the plural trap: a count needs
`fmtYears`-style `Intl.PluralRules` handling, not `${n} + unit` (Polish/Russian
inflect the noun by count).

The **editor** is the other side of that boundary and stays English — see
CLAUDE.md §12. Don't import `exportStrings.ts` from `components/`.

## 2. DOCX + PDF specifics

- **Both are lazy-loaded.** `ViewEditor` does
  `await import('../../../lib/exporter')` / `…/pdfExporter` on click. The
  `docx` library is ~352 kB; pdfmake is ~1.2 MB + a ~0.9 MB font vfs. **Never
  statically import `exporter.ts`, `pdfExporter.ts`, or `pdfmake` from an
  always-loaded module** or they rejoin the initial bundle. Verify after
  changes with `npm run build` — you should see separate `exporter-*.js` /
  `pdfmake-*.js` chunks, and the initial `index-*.js` should not jump.
- **`italics: true`, not `italic`.** The `docx` `TextRun` option is `italics`.
  Easy typo; `tsc` catches it, but know it.
- **`docx` XML-escapes `TextRun` text automatically** — the DOCX path is
  XSS-safe as long as content goes through `TextRun`. Do **not** hand-roll an
  XML/OOXML string emitter; if you ever do, it needs its own escaping. The PDF
  path likewise consumes a pdfmake object tree, never markup strings.
- **Style comes from `viewStyle.ts`, not constants.** All three document paths
  resolve the view's style through `withDefaults` → `withResolvedFonts` →
  `deriveTokens` (colors sanitised, enums coerced, fonts from the catalog).
  PDF can't embed arbitrary fonts, so each family maps onto a pdfmake
  standard-14 base font; brand defaults are the Cartavio tokens (see the
  cartavio-brand skill).
- `view.template_id` seeds a named **export template** (`lib/viewTemplates.ts`)
  — style/header/footer + section detail presets. It's applied at view-edit
  time, not at render; the renderers see only the resulting concrete config.

## 3. HTML/PDF specifics (`viewFilter.ts`) — escaping is mandatory

This path builds HTML by **string concatenation**, so every interpolated value
MUST be escaped. This is a security boundary, not a nicety — see the
security-review skill for the full rationale (imported content → preview/export
→ XSS → drive the API as the user via the session cookie).

- Every `${...}` that lands inside `<...>` goes through `escapeHtml(...)`
  (exported from `viewFilter.ts`), and description-shaped fields through
  `renderRichHtml`. `resolve()` returns raw text and does **not** escape.
- `buildViewHtml` emits a `<meta http-equiv="Content-Security-Policy">`
  defence-in-depth header. Keep it. Any *new* document/popup/iframe you open
  gets the same escape + CSP treatment.
- The **pop-out preview** is `window.open()` + `document.write(previewHtml)` →
  pop-ups must be allowed; the user gets an inline error if blocked. (PDF is a
  plain download — no popup involved.)

## 4. Adding a section or field to exports

1. Add (or extend) the **one descriptor** in `lib/sectionCatalog.ts` —
   title/subtitle + `summary()`/`full()` data views. Descriptors return
   **data only**; never build markup in a descriptor (the adapters own
   escaping). Per-path differences go behind `ctx.target`.
2. Confirm the section is in `SECTIONS` with a `storeKey` and reaches views
   via `isExportableSection` + `normalizeViewSections`; give it a
   `defaultViewDetail` if it shouldn't start as `full`.
3. A new *localized chrome string* goes in `lib/exportStrings.ts` (or the
   vocabulary's own home) with all 15 locales — `localeCoverage.test.ts`
   fails otherwise.
4. Respect `disabled`, exclusion, and `starred_only` by consuming the
   filtered store from `applyView` — don't re-read `store` directly.
5. Eyeball all four outputs (preview, PDF, DOCX, text) — one descriptor
   feeds them, but layout quirks are per-adapter.

## 5. Test discipline

- `tests/exporter.test.ts` (jsdom) — **structural smoke**, not byte-exact:
  the blob starts with the ZIP magic `PK\x03\x04`, contains `word/document.xml`
  + `[Content_Types].xml`, a bigger input yields a bigger file, excluded items
  are absent, and only `include_in_exports` references appear. Stub
  `URL.createObjectURL` and mock the anchor `click`.
- `tests/viewFilter.test.ts` — `applyView` filtering (sections/exclusions/
  starred), `buildViewHtml` content, and the **HTML-escaping (XSS) canary**.
  That XSS test is the regression net for the whole string-HTML class — never
  delete or weaken it.
- `tests/pdfExporter.test.ts` + `tests/viewText.test.ts` — same
  structural-smoke idea for the other two paths.
- After any change: `npm run typecheck && npm test && npm run build` (the build
  is the only check that proves the lazy chunks are still split).

## 6. When you touch this — checklist

1. Changed one render path's layout? Mirror it in the others (or comment why
   not).
2. Added a section? One descriptor in the catalog + the §4 steps.
3. Touched `viewFilter` string HTML? Every interpolation escaped? Run the XSS
   test.
4. Touched `exporter.ts`/`pdfExporter.ts` imports? Re-run `npm run build`;
   confirm the `exporter-*.js`/`pdfmake-*.js` chunks are still separate and
   initial JS didn't balloon.
