/**
 * Server-side copy of the client's skill-name normalization
 * (`src/lib/skillMatch.ts → normalizeKey` + `src/lib/skillExtract.ts →
 * skillKey`). The promote-to-instance-registry migration runs server-side over
 * every resume's stored data, so it needs the SAME key the client interns on —
 * otherwise the same skill would land in two canonical entries.
 *
 * Deliberately duplicated rather than imported: the server module graph stays
 * free of `src/` client code (the layer boundary in CLAUDE.md). This is the
 * `assetNameFor` pattern — a small mirror guarded by a cross-check test
 * (`tests/server/skillKey.test.ts`) that asserts it agrees with the client on a
 * table of names. KEEP IN SYNC with the two client functions.
 */

// Combining diacritical marks block U+0300–U+036F. Built with fromCharCode so
// the range survives being written to source as-is (see the Unicode-escape note
// in the project memory) — a literal-character class here is fragile.
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g')

/** Mirror of `src/lib/skillMatch.ts → normalizeKey`. */
export function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD').replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t && !/^\d+$/.test(t) && !/^v\d[\d.]*$/.test(t))
    .join(' ')
}

/** Mirror of `src/lib/skillExtract.ts → skillKey` (normalizeKey + drop trailing "js"). */
export function skillKey(name: string): string {
  const parts = normalizeKey(name).split(' ').filter(Boolean)
  if (parts.length > 1 && parts[parts.length - 1] === 'js') parts.pop()
  return parts.join(' ')
}
