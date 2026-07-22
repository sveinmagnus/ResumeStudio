---
title: Features
---

# Features

A tour of what Resume Studio does today. Most of these are visible the moment
you open the app — nothing here is buried behind config files.

## Editing

- **Dual-language side-by-side editing.** Every translatable field renders as
  two inputs at once. Pick any two of your supported locales as primary and
  secondary, swap them with one click, or hide the secondary column when you
  want to focus.
- **Translation assist on every field.** Each secondary input has a **Copy
  from primary** button (no network) and, when a translation provider is
  configured, a **Draft translation** button that pre-fills a machine
  translation for you to review. Drafts are always flagged as review-required.
- **Multiple translation providers.** LibreTranslate (Docker-managed local
  instance with a pick-your-languages install, or a remote URL you host),
  DeepL, Google Cloud Translation, Microsoft Azure Translator — or the AI
  model you configured for assist, with zero extra setup. Switch between
  them from Settings.
- **Re-detect languages.** A refresh button in the language switcher scans
  your content and adds any locale it finds to your supported list — handy
  after importing a CV.
- **Profiles with their own competencies.** Write several **profiles** — each a
  tag line plus a short and a long summary — and let every Resume View present
  one. The profile's tag line becomes that view's resume title. Each profile
  owns an ordered set of **key competencies** that travel with it: a view shows
  exactly the competencies of the profile it presents, in the order you set on
  the Profile page. Competencies live in a shared library, so the same one can
  belong to several profiles when you want to reuse it.
- **Course and certification categories, with dates.** Group courses and
  certifications with a shared set of categories (an editor-only organizing aid,
  never exported) and filter by them while editing. Courses take a from/to date
  range like your other timeline sections.
- **Rich text where it matters.** Project and role descriptions support
  bold, italic, underline, and bullet/numbered lists.
- **Profile photo and company logo.** Uploaded, downscaled in-browser,
  embedded in exports.
- **Drag-and-drop reordering** on every section, with keyboard up/down
  buttons retained for accessibility.
- **Undo / Redo** with debounced history (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z).
- **Global search** (Ctrl/Cmd+K) across every section, skill, role, and the
  header — jump straight to any item.
- **Career timeline.** An overview chart of employments, education, and
  projects, with work-history-gap detection and a full-width zoom.
- **Cross-language drift check.** The Overview flags fields whose two
  languages have drifted apart — a number that changed on one side but not
  the other (a wrong headcount, a dropped percentage, a timeline that runs a
  year longer in one language), or prose that grew in one language while the
  other stayed a stub. Click a flag to jump straight to the field. It's the
  natural companion to the completeness meter: one tells you what's missing,
  the other what's out of sync.
- **Freshness warnings.** The overview flags expired or expiring
  certifications and suspiciously long "ongoing" items; anything you've
  checked can be snoozed for a year.

## Skills, roles & categories

- **Shared registries.** Skills, roles, and industries live once and are
  referenced everywhere — rename a skill and every project updates.
- **Registry merge.** The "Løsningarkitekt" vs "Løsningsarkitekt" problem:
  pick one as canonical, the other gets rewritten everywhere it's referenced
  and removed.
- **Skill categories & showcase.** Group skills into your own categories
  (drag-and-drop between them), highlight the ones to showcase, and the
  exported "Skills Showcase" section builds itself from those choices.
- **Curated skill library.** Autocomplete against 1,200+ canonical skill
  names so imports and typing don't mint near-duplicates; related-skill
  suggestions; one-click **auto-categorization** of uncategorized skills —
  offline, no service involved.
- **Skill matrix.** An exportable skill × years × proficiency × last-used
  table derived from your project history.

## AI assist — bring your own model

One model powers every AI feature, and you choose where it runs: a **local
Ollama** (the app can run it in Docker for you — your CV never leaves the
machine), **OpenAI**, or **any OpenAI-compatible endpoint** (LM Studio, Groq,
OpenRouter, …). Every AI button states plainly whether content stays on this
computer or goes to your provider, results are always drafts you review
before they touch your CV, and with no model configured the buttons simply
hide. Every feature also has a **manual path** — copy a generated prompt into
whatever AI you already use and paste the answer back — so nothing requires
an API key.

- **One-line summaries.** Draft a short description from a long one — per
  field, or "Bulk summarize" for a whole section at once (with a confirmation
  that explains what will run).
- **Job-posting tailoring.** Paste a posting and get a proposed view:
  section detail levels, item exclusions, a drafted intro, and a gap list.
- **Skill suggestions.** Propose the skills a project's prose demonstrates,
  matched against your existing registry so it links "React" rather than
  minting "React.js".
- **Drafted project highlights** from the project description.
- **Anonymization check.** Scan an anonymized view for real client names
  that leaked through in prose.
- **Cover-letter draft.** Turn a job posting plus the CV you're sending into a
  drafted letter body — grounded in your real experience, never invented.
- **Page-fit advice.** When a view runs over its page limit, get concrete
  suggestions for what to cut.
- **AI import and bulk add** — see the Import section below.

## Multi-resume

- **One app, many master CVs.** Keep separate CVs for different lines of
  work, joint ventures, or career chapters. The picker is the home screen;
  each CV has its own URL, history, and supported languages.
- **Per-resume language pair.** Each CV remembers which two languages you
  were last editing in.
- **"Who knows what" skill matrix.** With more than one CV in the instance, the
  picker offers a skill × person grid across everyone — who has which skill and
  at what proficiency, with a filter for the skills more than one person shares
  (team overlap) versus the ones only a single person holds (bus-factor risks).
  Click a name to open that CV.
- **Shared registries across CVs.** From the same panel, "Share registries
  across resumes" links matching skills, roles and industries to one shared
  registry — after which renaming a skill in any CV updates it in all of them,
  while each person keeps their own proficiency and highlights.

## Resume Views — targeted exports

- **Curated subsets of the master CV.** A view names a set of sections to
  include, items to exclude, a starred-only toggle, and a custom intro.
- **Per-section detail levels.** Each section can be Off, Summary, Tabulated
  (aligned columns), or Full — so a one-pager and a deep technical CV share
  the same source data. Sections can also flip to starred-only individually
  and be bulk-selected by type facets (e.g. only Research publications).
- **Per-view styling.** Density, body size, fonts, heading and accent
  colors, page margin, tag style, item dividers and bullets, section icons,
  custom section headings, date formats, per-section sort and summary
  layout — all stored on the view, not the master CV.
- **Configurable header and footer.** Choose which contact fields appear,
  the labels and separators, name/title type size, photo and logo placement,
  and a footer note.
- **Live preview pane.** The document re-renders as you tune the view, with a
  page-count estimate against your page limit.
- **Export templates.** Named presets (compact technical, formal management,
  minimal one-pager) that seed a view's style, header/footer, and section
  detail in one click.
- **Job-posting tailoring.** Paste a job posting and run it with your
  configured model in one click — or copy the generated prompt into any LLM
  and paste the answer back. Either way the view reorders and trims itself
  for that role, as a proposal you review first.
- **Page limit with real advice.** Set a page budget, watch the live
  page-count estimate, and ask the AI what to cut when you're over.
- **Anonymized variants.** A per-view toggle that anonymizes customers and
  redacts references to initials — for tenders and broker submissions.
- **Per-view export language** — the same view can ship in English to one
  client and Norwegian to another.
- **Promoted Projects** and **Skill Matrix** as synthetic sections — surface
  starred projects or a skills table without restructuring the master.

## Cover letters

- **A letter per application, paired with a view.** A cover letter is its own
  document that references the Resume View it accompanies — write several
  against one CV, one per role you apply for.
- **Drafted from the posting.** Paste the job posting and draft the letter body
  with your configured model (or copy the prompt into any LLM), grounded in the
  CV you're actually sending — it won't invent employers or numbers.
- **Matching letterhead.** The letter borrows the linked view's fonts and your
  contact details, so letter and CV read as one submission. Export to PDF,
  DOCX, or plain text, in any of your languages.

## Export

- **PDF** — a one-click vector download, rendered from the same section
  catalog as the preview.
- **DOCX** (`.docx`) via the [`docx`](https://docx.js.org/) library, lazy-
  loaded so the bundle only grows when you actually export.
- **Plain text & Markdown** — ATS-friendly exports for application portals
  that mangle formatted documents.
- **Europass XML** — the `SkillsPassport` format EU and Norwegian public
  tenders ask for, and the round-trip partner of the Europass import. Covers
  identity, work history, education and language skills (with CEFR levels);
  the sections Europass has no concept of stay in the richer PDF/DOCX exports.
- **Fully localized output.** Every piece of document chrome a client reads —
  section headings, month names, "Present", contact-field labels, skill-matrix
  columns, language levels — ships translated in all 15 offered languages, so
  a Norwegian or German export never leaks English labels.
- **Language proficiency done properly.** Spoken languages render as a
  compact one-liner or a full Europass CEFR passport (A1–C2 per skill),
  your choice per view.

## Import & backup

- **CVpartner JSON import.** The importer handles both shapes CVpartner
  emits (object and interleaved-array localized values), normalises `int` →
  `en`, scans content for under-declared locales, and links projects to work
  experiences through the source IDs.
- **LinkedIn import.** Drop the LinkedIn data-export `.zip` on the picker and
  get a working resume.
- **Europass import.** Reads both SkillsPassport XML and Europass profile
  JSON.
- **AI-assisted import from PDF or Word.** Paste your CV's text and run the
  import with your configured model in one click — or download the
  instruction template, run it in any LLM, and paste the JSON back. Either
  way you preview the result before it becomes a resume.
- **Per-section bulk add.** Paste raw source material (an old CV chapter, a
  course list, a project log) and turn it into many items in one reviewed
  batch — with the same one-click-or-manual AI choice, and duplicates
  detected against what the section already has.
- **Portable JSON backup.** Per-resume export from the editor; versioned
  format with a migration scaffold so older backups keep loading.
- **Server-side snapshot history.** Every save is snapshotted (last 50 per
  resume, duplicates skipped). The header's **History** button restores any
  version — and the restore itself is undoable.

## Persistence & offline tolerance

- **Auto-save** to a local SQLite database (debounced ~1 s).
- **localStorage fallback** per resume, so a momentary outage never costs
  work. Edits flush the moment the server returns.
- **Status visible in the header** — Saving / Saved / Offline / Queued /
  Conflict, with a count of any resumes still waiting to sync.
- **Optimistic concurrency.** If two devices race on the same resume, the
  loser sees a non-blocking **Conflict** modal with a labelled diff and a
  keep-mine / discard-mine choice.

## Cross-computer sync (desktop)

- **Backup folder in your existing cloud sync** (Google Drive, Dropbox,
  OneDrive). Resume Studio writes a single JSON file there, atomically, and
  merges newer content from it on every launch.
- **Newest-wins per resume, never deletes.** Safe by design — a restore
  drops a snapshot first, so it's reversible from History.
- **No real-time multi-writer.** Designed for one person hopping between
  computers, not for two people editing the same CV at once.
- **Automatic updates.** The desktop app checks GitHub Releases daily (or on
  demand from the tray / Settings) and installs a new version in place with
  one click — no reinstall, your data untouched.

## Privacy & security posture

- **Your CV never leaves your machine** unless you point translation or AI
  assist at a remote provider — and the app says exactly where content goes
  before you run anything. Local options (Docker LibreTranslate, Ollama)
  keep everything on your computer.
- **No account, no telemetry, no analytics.**
- **Loopback-only on desktop.** The local server binds `127.0.0.1` — the app
  is never exposed to your network.
- **Auth-gated when self-hosted.** Server deployments require a bearer token;
  the browser exchanges it for an HttpOnly session cookie so the token never
  lives in JavaScript-readable storage.
- **Content sanitised at the render boundary.** Rich text, view styling, and
  imported view configs are sanitised before they reach the export or preview
  pipelines.

---

Ready to try it? [Head to the downloads.](download.html)
