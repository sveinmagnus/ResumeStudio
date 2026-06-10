# External skills (referenced, not vendored)

Some useful skills live in the machine-global skills folder
`C:\Users\svein\.agents\skills\` and are **not** copied into this repo because
their license is proprietary (© Anthropic, PBC — governed by the Anthropic
terms of service, not redistributable). Read them from the global path when
the task calls for them.

| Skill | Path | Use here for |
|---|---|---|
| **docx** | `C:\Users\svein\.agents\skills\docx\SKILL.md` | Inspecting/validating the OOXML inside files produced by `lib/exporter.ts` — real QA of DOCX exports (content, styles, structure), not just "export didn't throw". |
| **pdf** | `C:\Users\svein\.agents\skills\pdf\SKILL.md` | Extracting text/structure from PDFs — verifying the print-pipeline output, and working with PDF CVs in the AI-import flow. |

Also available globally but rarely relevant to this project: `pptx`, `xlsx`
(same proprietary license), plus Apache-2.0 skills not vendored here
(`skill-creator`, `claude-api`, `mcp-builder`, `frontend-design`) and ~15
WordPress skills.

**Conventions:**
- If a skill at the global path is missing (e.g. on another machine), say so
  and proceed without it — don't fail the task.
- Openly-licensed skills that this project uses regularly get **copied** into
  `.claude/skills/` (current: `webapp-testing`, `web-design-guidelines`,
  `github-actions-docs` — folder-style, `<name>/SKILL.md`) so the repo stays
  self-contained. Proprietary ones stay referenced here.
- Every skill — vendored or referenced — gets a unit in `knowledge.yaml`.
