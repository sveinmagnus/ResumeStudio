# Third-party components

Cartavio Resume Studio is proprietary (see [LICENSE](./LICENSE)), but it ships
third-party open-source components. Each is listed here with its licence.
Nothing in Resume Studio's own licence limits your rights under these.

Three of them carry obligations that a downloadable build has to satisfy, and
they are the reason this file exists rather than being implied by
`package.json`:

- **Apache-2.0** (the skill taxonomy, Roboto) requires the licence text and
  attribution to travel with the distribution.
- **The Ubuntu Font Licence** requires the licence to accompany the font files.
- **MIT / ISC** require the copyright notice and permission text to be included
  with distributed copies.

The desktop build is a redistribution, so `scripts/build-desktop.mjs` copies
this file into `release/` alongside the binaries.

---

## Bundled fonts

Both are self-hosted in `public/fonts/` rather than loaded from a CDN (GDPR,
offline support, and the `font-src 'self'` CSP).

| Font | Used for | Licence |
|---|---|---|
| Open Sans Condensed (Light 300) | Headings | Apache License 2.0 |
| Ubuntu (400, 500) | Body text | Ubuntu Font Licence 1.0 |
| Roboto | PDF export (embedded by pdfmake) | Apache License 2.0 |

Roboto arrives as part of pdfmake's font VFS. It is the only font Resume Studio
embeds into a generated PDF; the other export families map onto the PDF
standard-14 base fonts, which are not embedded (see `src/lib/fonts.ts`).

## Skill taxonomy data

| Component | Licence | Source |
|---|---|---|
| Quadim Public Skill Library | Apache License 2.0 | https://github.com/quadim/Public-SkillDefinitions |

Shipped as the derived artifacts in `src/generated/skill*.json`, produced by
`scripts/build-skill-taxonomy.mjs`. These are a slimmed derivative of the
upstream dataset, so the Apache-2.0 attribution requirement applies to Resume
Studio builds even though the upstream repository is not included.

## Runtime dependencies

Everything below ships in the application bundle or the desktop build.

| Package | Version | Licence |
|---|---|---|
| @dnd-kit/core | 6.3.1 | MIT |
| @dnd-kit/sortable | 10.0.0 | MIT |
| @dnd-kit/utilities | 3.2.2 | MIT |
| docx | 9.7.1 | MIT |
| express | 5.2.1 | MIT |
| express-rate-limit | 8.6.1 | MIT |
| fflate | 0.8.3 | MIT |
| lucide-react | 1.28.0 | ISC |
| pdfmake | 0.3.11 | MIT |
| react | 19.2.8 | MIT |
| react-dom | 19.2.8 | MIT |
| systray2 | 2.1.4 | MIT |
| zustand | 5.0.14 | MIT |

Each package's full licence text ships inside its own directory under
`node_modules/`, and in the desktop build inside the bundled application tree.

Development-only dependencies (TypeScript, Vite, Vitest, Playwright, ESLint and
their trees) are not listed: they are not distributed with the application.

## Node.js

The desktop build bundles the Node.js runtime binary it was built with
(`process.execPath`, copied by `scripts/build-desktop.mjs`). Node.js is
distributed under the MIT licence, with its dependencies' licences collected in
the `LICENSE` file shipped inside the Node distribution.

## Regenerating this file

The dependency table is small and changes rarely, so it is maintained by hand
and checked at release time — see [RELEASING.md](./RELEASING.md). To re-read the
current set:

```bash
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));for(const n of Object.keys(p.dependencies)){const d=JSON.parse(fs.readFileSync('node_modules/'+n+'/package.json','utf8'));console.log(n,d.version,d.license)}"
```
