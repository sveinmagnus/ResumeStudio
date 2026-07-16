---
name: export-pipeline
description: How Resume Studio renders a Resume View to PDF (HTML/print) and DOCX, and the rules that keep the two paths in sync. Use before changing src/lib/viewFilter.ts, src/lib/exporter.ts, the live preview, or the Export buttons in ResumeViewsEditor — or when adding a section/field to exports. Covers the two-render-path parity, the docx lazy-load discipline, the `italics` gotcha, and the escaping cross-check.
---

# Export pipeline (PDF + DOCX)

A Resume View is exported through **two independent render paths** that must
stay visually and structurally in agreement. The whole class of export bugs is
"changed one path, forgot the other." Read this before touching either renderer
or the export UI. Pairs with CLAUDE.md §7 (adding a section) and the
security-review skill (escaping).

## 1. The two paths (keep them in sync)

Both consume the **filtered** store from `applyView(store, view)` (drops hidden
sections, excluded items, and — if set — non-starred items). Then:

- **PDF / preview** → `viewFilter.ts → buildViewHtml()` builds an HTML string.
  It's rendered two ways: the live preview pane (`<iframe srcDoc={previewHtml}>`
  in `ResumeViewsEditor`) and the print export (`win.document.write(html)` →
  `window.print()`).
- **DOCX** → `exporter.ts → exportDocx()` builds a `docx` `Document` from the
  same filtered store.

Both paths (plus a third consumer — `getItemTitle` / `getItemSubtitle` in
`viewFilter.ts`, which feed the View-editor's item-toggle list) are driven by a
**single section-descriptor catalog** (`lib/sectionCatalog.ts`, one descriptor
per section with `summary()` / `full()` data views). `renderItem` (viewFilter),
`renderSection` (exporter), and the title/subtitle pair all read `SECTION_CATALOG`
— there are no per-section switch statements left. So "support a section in
exports" means **adding one descriptor**, not editing three renderers; the
adapters own escaping/layout. See CLAUDE.md §7 step 7.

**Rule:** if a section/field renders in one path, it renders in the other (or
there's a deliberate, commented reason it doesn't — e.g. the `skills`/`roles`
*registries* are intentionally never exported as their own sections).

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

## 2. DOCX specifics (`exporter.ts`)

- **It is lazy-loaded.** `ResumeViewsEditor` does
  `const { exportDocx } = await import('../../lib/exporter')` on click. The
  `docx` library is ~352 kB. **Never statically import `exporter.ts` from an
  always-loaded module** or it rejoins the initial bundle. Verify after changes
  with `npm run build` — you should see a separate `exporter-*.js` chunk, and
  the initial `index-*.js` should not jump ~350 kB.
- **`italics: true`, not `italic`.** The `docx` `TextRun` option is `italics`.
  Easy typo; `tsc` catches it, but know it.
- **`docx` XML-escapes `TextRun` text automatically** — the DOCX path is
  XSS-safe as long as content goes through `TextRun`. Do **not** hand-roll an
  XML/OOXML string emitter; if you ever do, it needs its own escaping.
- **Brand + page constants** live at the top: `ACCENT_HEX` (Cartavio navy
  `002E6E`), `HEADING_FONT` (`Open Sans Condensed`), `BODY_FONT` (`Ubuntu`), A4
  page size in twips. Keep DOCX output visually aligned with the HTML/PDF brand
  (see the cartavio-brand skill).
- `view.template_id` seeds a named **export template** (`lib/viewTemplates.ts`)
  — style/header/footer + section detail presets. It's applied at view-edit
  time, not at render; the renderers see only the resulting concrete config.

## 3. HTML/PDF specifics (`viewFilter.ts`) — escaping is mandatory

This path builds HTML by **string concatenation**, so every interpolated value
MUST be escaped. This is a security boundary, not a nicety — see the
security-review skill for the full rationale (imported content → export → XSS →
token theft).

- Every `${...}` that lands inside `<...>` goes through `escapeHtml(...)`
  (exported from `viewFilter.ts`). `resolve()` returns raw text and does **not**
  escape. The `l()`/`r()` helpers in `renderItem` already wrap `escapeHtml`.
- `buildViewHtml` emits a `<meta http-equiv="Content-Security-Policy">`
  defence-in-depth header. Keep it. Any *new* document/popup/iframe you open
  gets the same escape + CSP treatment.
- PDF export is `window.open()` + `window.print()` → **pop-ups must be
  allowed**; the user gets an `alert()` if blocked.

## 4. Adding a section or field to exports

1. `viewFilter.ts → renderItem`: add a `case` for the section (HTML, escaped).
2. `exporter.ts → renderSection`: add the matching `case` (DOCX, via
   `TextRun`/paragraph helpers).
3. `viewFilter.ts → getItemTitle` / `getItemSubtitle`: so the item appears in
   the View editor's toggle list.
4. Confirm the section is in `SECTIONS` with a `storeKey` and not excluded by
   `applyView`.
5. Render the *same fields* in both paths; respect `disabled`, exclusion, and
   `starred_only` (handled by `applyView`, so consume the filtered store —
   don't re-read `store` directly).

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
- After any change: `npm run typecheck && npm test && npm run build` (the build
  is the only check that proves the lazy chunk is still split).

## 6. When you touch this — checklist

1. Changed one render path? Mirror it in the other (or comment why not).
2. Added a section? Update all three switches (§4).
3. Touched `viewFilter` string HTML? Every interpolation escaped? Run the XSS
   test.
4. Touched `exporter.ts` imports? Re-run `npm run build`; confirm the
   `exporter-*.js` chunk is still separate and initial JS didn't balloon.
