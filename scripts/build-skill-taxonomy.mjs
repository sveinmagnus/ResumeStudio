/**
 * Regenerate the slim Quadim Public Skill Library artifacts the app ships:
 *   - src/generated/skillTaxonomy.json       — flat list of canonical names (F12 pt1/2)
 *   - src/generated/skillRelations.json      — name → related names map (F12 pt3)
 *   - src/generated/skillClassifications.json — name → authoritative classification (F12 pt4)
 *
 * Both are lazy-loaded by lib/skillTaxonomy.ts so the runtime never fetches
 * anything and CI never needs the source repo. Re-run this script (and commit
 * the results) when the library updates:
 *
 *   node scripts/build-skill-taxonomy.mjs [path-to-skills-index.json]
 *
 * Source: Quadim Public-SkillDefinitions (Apache-2.0,
 * https://github.com/quadim/Public-SkillDefinitions). Default path is
 * ../Public-SkillDefinitions/docs/data/skills-index.json relative to the repo
 * root (the layout on the maintainer's machine).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = process.argv[2]
  ?? path.join(root, '..', 'Public-SkillDefinitions', 'docs', 'data', 'skills-index.json')
const namesTarget = path.join(root, 'src', 'generated', 'skillTaxonomy.json')
const relTarget = path.join(root, 'src', 'generated', 'skillRelations.json')
const classTarget = path.join(root, 'src', 'generated', 'skillClassifications.json')

const index = JSON.parse(fs.readFileSync(source, 'utf8'))
if (!Array.isArray(index)) throw new Error('skills-index.json: expected an array')

// Slim to unique, trimmed names (the library zero-pads some with spaces).
// English-only by design — suggested names enter the registry as `en` values.
const seen = new Set()
const names = []
const canonicalByLower = new Map() // lowercased -> canonical spelling
for (const entry of index) {
  const name = String(entry?.name ?? '').trim()
  if (!name) continue
  const key = name.toLowerCase()
  if (seen.has(key)) continue
  seen.add(key)
  names.push(name)
  canonicalByLower.set(key, name)
}
names.sort((a, b) => a.localeCompare(b, 'en'))

fs.mkdirSync(path.dirname(namesTarget), { recursive: true })
fs.writeFileSync(namesTarget, JSON.stringify(names, null, 0) + '\n', 'utf8')
console.log(`Wrote ${names.length} skill names (${fs.statSync(namesTarget).size} bytes) to ${path.relative(root, namesTarget)}`)

// ── Relations (F12 pt3) ──────────────────────────────────────────────────────
// Each entry's `rt` ("relates to") holds free-text names; resolve them to
// canonical entries (case-insensitive) and build a BIDIRECTIONAL adjacency map
// — "related" is symmetric in spirit, which gives better suggestion coverage.
const adjacency = new Map() // canonical name -> Set<canonical name>
const link = (a, b) => {
  if (a === b) return
  if (!adjacency.has(a)) adjacency.set(a, new Set())
  adjacency.get(a).add(b)
}
for (const entry of index) {
  const name = String(entry?.name ?? '').trim()
  const canon = canonicalByLower.get(name.toLowerCase())
  if (!canon || !Array.isArray(entry?.rt)) continue
  for (const raw of entry.rt) {
    const other = canonicalByLower.get(String(raw ?? '').trim().toLowerCase())
    if (!other) continue // unresolvable rt label — skip rather than invent
    link(canon, other)
    link(other, canon)
  }
}
const relations = {}
for (const name of [...adjacency.keys()].sort((a, b) => a.localeCompare(b, 'en'))) {
  relations[name] = [...adjacency.get(name)].sort((a, b) => a.localeCompare(b, 'en'))
}
fs.writeFileSync(relTarget, JSON.stringify(relations, null, 0) + '\n', 'utf8')
console.log(`Wrote ${Object.keys(relations).length} related-skill entries (${fs.statSync(relTarget).size} bytes) to ${path.relative(root, relTarget)}`)

// ── Classifications (F12 pt4) ────────────────────────────────────────────────
// Each entry's `ce` is its authoritative classification (Technical /
// Management / Analytical / …). Emit canonical name → classification for the
// skill-matrix Category column. First spelling wins on dupes.
const classifications = {}
for (const entry of index) {
  const name = String(entry?.name ?? '').trim()
  const canon = canonicalByLower.get(name.toLowerCase())
  const ce = String(entry?.ce ?? '').trim()
  if (!canon || !ce || classifications[canon]) continue
  classifications[canon] = ce
}
const sortedClass = {}
for (const name of Object.keys(classifications).sort((a, b) => a.localeCompare(b, 'en'))) {
  sortedClass[name] = classifications[name]
}
fs.writeFileSync(classTarget, JSON.stringify(sortedClass, null, 0) + '\n', 'utf8')
console.log(`Wrote ${Object.keys(sortedClass).length} classifications (${fs.statSync(classTarget).size} bytes) to ${path.relative(root, classTarget)}`)
