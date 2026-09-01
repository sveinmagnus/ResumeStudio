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
  the Profile page (drag to reorder, or pull in a batch of existing ones with
  checkboxes). Competencies live in a shared library, so the same one can belong
  to several profiles when you want to reuse it — and the Key Competencies page
  has a **By profile** view that groups them under each profile.
- **Course, certification and presentation dates & categories.** Group courses
  and certifications with a shared set of categories (an editor-only organizing
  aid, never exported) and filter by them while editing. Courses and
  presentations take a from/to date range like your other timeline sections — so
  a talk you've given regularly over a period reads correctly.
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
machine), **OpenAI**, **Anthropic**, **Google Gemini**, **Mistral**, or **any
OpenAI-compatible endpoint** (LM Studio, Groq, OpenRouter, …). The model field
offers a live pick-list of what your provider actually has. Every AI button
states plainly whether content stays on this computer or goes to your provider,
results are always drafts you review before they touch your CV, and with no
model configured the buttons simply hide. Every feature also has a **manual
path** — copy a generated prompt into whatever AI you already use and paste the
answer back — so nothing requires an API key.

- **One-line summaries.** Draft a short description from a long one — per
  field, or "Bulk summarize" for a whole section at once (with a confirmation
  that explains what will run).
- **Job-posting tailoring.** Paste a posting and get a proposed view:
  section detail levels, item exclusions, a drafted intro, and a gap list.
- **Skill suggestions.** Propose the skills a project's prose demonstrates,
  matched against your existing registry so it links "React" rather than
  minting "React.js".
- **Drafted project highlights** from the project description.
- **Strengthen the wording.** Coach an existing description into tighter,
  stronger prose — grounded in what you actually wrote, never inventing
  employers, numbers, or claims. It sees the entry's own fields (name, dates,
  issuer…), so it won't restate them or ask you for facts that already have a
  field — and text that already reads well is told so instead of reworded.
- **Assists keep working while you do.** Start one and carry on — move to
  another item, another section, or reload the page. The spinner is still there
  when you come back, a finished suggestion waits until you accept or discard
  it (ticks and all), and a notice tells you the moment it's ready wherever you
  happen to be.
- **Anonymization check.** Scan an anonymized view for real client names
  that leaked through in prose.
- **Cover-letter draft.** Turn a job posting plus the CV you're sending into a
  drafted letter body — grounded in your real experience, never invented.
- **Page-fit advice.** When a view runs over its page limit, get concrete
  suggestions for what to cut.
- **AI import and bulk add** — see the Import section below.

### The advanced assists

If the model you configured is a strong one, tick **“This is a high-end model”**
in Settings and a second tier appears. These read the *whole* CV and make
comparative judgements about it — the kind of work a small local model answers
fluently and wrongly, which is why you declare it rather than the app guessing.
With the box unticked they are simply not there.

- **Review my whole CV.** A prioritised list of what a reader would hold
  against it: descriptions with no outcome, wildly uneven detail, repeated
  phrasing, timeline gaps. Every finding links straight to the item.
- **Consistency & voice.** One register across the document — same person, same
  tense, technology names spelled the same way — as a batch of before/after
  rewrites you tick to apply.
- **Cross-language meaning check.** Does the Norwegian actually say what the
  English says? Catches dropped sentences and terms translated three ways.
- **Achievement mining.** Finds outcomes buried in long prose and proposes them
  as highlights or competencies — quoting the sentence that supports each one,
  and filling both language columns.
- **Job fit report.** Requirement by requirement against a posting: what you can
  evidence, what you can't, and what you *nearly* can — the gap you can close
  honestly by naming something you already did.
- **ATS keyword audit.** Reads the text a view actually exports and reports
  which of a posting's terms appear in it. **The first pass needs no AI at
  all.** Its most useful verdict is “in your CV but excluded by this view” —
  fixed by re-including an item, with no writing.
- **Profile generator, view introductions, and “what's missing” per section.**
- **Registry hygiene.** Proposes skill merges and categories for the
  uncategorised tail. Proposal-only: nothing is pre-ticked, every row states
  what it deletes and how many references it rewrites, and a confirm names the
  totals first.
- **Cover-letter angles and critique.**

Runs survive you walking away from them: results are kept per CV, so you can go
and fix the thing a finding just told you about and come back to the rest.

## Teams and accounts (self-hosted)

The desktop app never asks you to sign in — it is your machine, and a login
screen would be friction and nothing else. A self-hosted instance can hold
several people instead.

- **Setting it up is one code.** The server prints a one-time setup code when it
  starts with no accounts. Spend it, and the account you create becomes the
  **owner** and takes ownership of every résumé already there.
- **Invite by link.** The owner generates a single-use link and passes it on
  however they already talk. No email server required.
- **Your résumés are private by default.** Nobody else on the instance sees
  them until you share one — and sharing makes it **readable, never editable**.
  A colleague opening a shared CV gets it read-only; they cannot change your
  words.
- **The owner can see everything.** Deliberate, and stated plainly here because
  it is the sort of thing you should not discover later: it is what makes
  staffing work, whole-instance backups, and recovering a CV after somebody
  leaves possible.
- **Sign in with your username or your email** — whichever you remember.
- **Four ways back in** if you forget your password: a recovery code you saved
  when the account was made, a link the owner mints for you, an email link if
  the owner has configured mail, or — for an owner locked out with nobody above
  them — a command run on the server itself.

Email is optional and off unless the owner configures it. It is used for exactly
two things: a password-reset link and confirming an address. **No CV content is
ever emailed**, and an address only receives resets after its confirmation link
has been followed.

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
- **Purpose note.** Jot down why a view exists — which client, tender, or role
  it's for — as a private reminder shown on the view (with an edit pencil).
  It's never exported.
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

- **What you previewed is what you send.** The live preview, the PDF, the Word
  file and the ATS text state the same facts and honour the same style choices.
  Optional extras — links, team size and allocation, referee contact details,
  grades, expiry dates, locations — are switched on **per view**, so what an
  export contains is something you chose rather than a side effect of which
  button you pressed. Every group starts off.
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
  OneDrive). Resume Studio writes **one JSON file per CV** there, atomically,
  and merges newer content back in **continuously while it runs** — not only at
  launch — so edits made on another computer land within seconds of your sync
  client delivering them, even if you leave the app open for days. If the CV
  you're viewing was updated elsewhere, a small **"updated on another device —
  Reload"** notice appears.
- **One file per person, on purpose.** A CV is one identified individual's
  data, so removing someone from your backups is deleting one file — not
  editing a document that holds everybody. You can also hand a single CV to
  someone by sending its file.
- **Newest-wins per CV.** A restore drops a snapshot first, so it's reversible
  from History. Nothing is removed except CVs you deleted yourself: a deletion
  writes an id-and-timestamp marker the other machines honour, and a copy saved
  *after* the deletion counts as a revival and is kept.
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
  is never exposed to your network, including when you reach it under the
  friendly local name (`resumestudio.localhost`) instead of the IP.
- **Auth-gated when self-hosted.** Server deployments require a bearer token;
  the browser exchanges it for an HttpOnly session cookie so the token never
  lives in JavaScript-readable storage.
- **Content sanitised at the render boundary.** Rich text, view styling, and
  imported view configs are sanitised before they reach the export or preview
  pipelines.

The full detail — every host the app can contact, what each provider receives,
how sync folders and deletion work — is in
[PRIVACY.md](https://github.com/sveinmagnus/resumestudio/blob/main/PRIVACY.md).
To report a security issue, see
[SECURITY.md](https://github.com/sveinmagnus/resumestudio/blob/main/SECURITY.md).

---

Ready to try it? [Head to the downloads.](download.html)
