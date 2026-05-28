# Resume Studio — Multi-Language Consultant Resume Manager

A web app for maintaining one master consultant resume across multiple languages, with side-by-side dual-language editing and import from the CVpartner JSON format.

## What's built (this iteration)

- **CVpartner import** — drop a CVpartner JSON export and it maps cleanly into the data model. Tested against a real 45-project export.
- **Dual-view multi-language editing** — every translatable field renders as two side-by-side inputs (primary + secondary language). Switch or swap languages from the header; hide the secondary column when you want to focus on one.
- **Full content management** — projects (with roles, skills, highlights), employment, positions, education, courses, certifications, skills showcase, languages, presentations, publications, awards, references.
- **Global registries** — skills and roles live once and are referenced by projects, so total experience can be computed across all projects.
- **Overview dashboard** — content counts and a per-language translation-completeness bar.
- **Master JSON export** — export the full normalized data model.

## Not yet built (planned next)

- Targeted resume extraction (filter by skill tags → preview)
- `.docx` and `.pdf` export pipeline
- Persistence (currently in-memory for the session)

## Run it

```bash
npm install
npm run dev      # development server
npm run build    # production build → dist/
npm run preview  # serve the production build
```

## Architecture

- **React 18 + TypeScript + Vite**
- **Zustand** for state (single normalized store mirroring the data model)
- All types in `src/types/index.ts`
- Importer in `src/lib/importer.ts`
- The dual-language field component is `src/components/ui/DualField.tsx`

## Importing

The importer (`src/lib/importer.ts`):
- Maps CVpartner's `{ no, int, se, dk }` localized objects to our `{ no, en, se, dk }` (renaming `int` → `en`).
- Auto-detects every locale actually present in the content (not just the declared `language_codes`).
- Builds the global skill registry from `technologies` + any project-only skills.
- Builds the global role registry from `cv_roles`, linked from project roles.
