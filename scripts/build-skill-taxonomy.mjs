/**
 * Regenerate src/generated/skillTaxonomy.json from the Quadim Public Skill
 * Library (Apache-2.0, https://github.com/quadim/Public-SkillDefinitions).
 *
 * The app ships a slim, committed name list — lazy-loaded by
 * lib/skillTaxonomy.ts — so the runtime never fetches anything and CI never
 * needs the source repo. Re-run this script (and commit the result) when the
 * library updates:
 *
 *   node scripts/build-skill-taxonomy.mjs [path-to-skills-index.json]
 *
 * Default source: ../Public-SkillDefinitions/docs/data/skills-index.json
 * relative to the repo root (the layout on the maintainer's machine).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = process.argv[2]
  ?? path.join(root, '..', 'Public-SkillDefinitions', 'docs', 'data', 'skills-index.json')
const target = path.join(root, 'src', 'generated', 'skillTaxonomy.json')

const index = JSON.parse(fs.readFileSync(source, 'utf8'))
if (!Array.isArray(index)) throw new Error('skills-index.json: expected an array')

// Slim to unique, trimmed names (the library zero-pads some with spaces).
// English-only by design — suggested names enter the registry as `en` values.
const seen = new Set()
const names = []
for (const entry of index) {
  const name = String(entry?.name ?? '').trim()
  if (!name) continue
  const key = name.toLowerCase()
  if (seen.has(key)) continue
  seen.add(key)
  names.push(name)
}
names.sort((a, b) => a.localeCompare(b, 'en'))

fs.mkdirSync(path.dirname(target), { recursive: true })
fs.writeFileSync(target, JSON.stringify(names, null, 0) + '\n', 'utf8')
console.log(`Wrote ${names.length} skill names (${fs.statSync(target).size} bytes) to ${path.relative(root, target)}`)
