/**
 * The readable address a resume is reached at — `/r/sveinsgmail` instead of
 * `/r/6f3a…-…`.
 *
 * The address is DERIVED from the person's email, never stored: an email
 * rarely changes, so the address is stable, and there is no second field that
 * can drift out of sync with the first. Two spellings exist per email —
 * `name-domain` with the TLD dropped (`sveins@gmail.com` → `sveins-gmail`),
 * and `name-domain-tld` as the collision escape when two people in the org
 * share the short one. A DASH separates the parts (that's the spec: the name
 * and the company must read apart); symbols are stripped WITHIN each part, so
 * every slug is lowercase `a–z0–9` in one-to-three dash-joined runs, needing
 * no URL-encoding. A UUID is excluded from the slug shape by an explicit
 * check (`isSlugSegment`), not by charset — both spellings carry dashes now.
 *
 * The UUID keeps working as an address forever — a slug is an ALIAS the URL
 * bar prefers, not a replacement key. Resolution is deliberately strict: a
 * segment matching several resumes (a collision that appeared after a link
 * was shared) resolves to nothing rather than to a guess, because opening the
 * WRONG person's CV is worse than a bounce to the picker.
 */

/** What slug derivation and resolution need to know about one resume. */
export interface SlugCandidate {
  id: string
  email?: string | null
}

/**
 * The slug for one email, or null when the email cannot yield one (no `@`,
 * or nothing alphanumeric survives on either side). The name and the domain
 * are dash-separated — `name-domain` — with the domain's final label dropped
 * (`gmail.com` → `gmail`); `withTld: true` appends that label as a third
 * dash-joined part (`name-domain-tld`). A single-label domain keeps its one
 * label in both forms, since dropping it would erase the domain entirely.
 */
export function emailSlug(email: string, withTld: boolean): string | null {
  const raw = email.trim().toLowerCase()
  const at = raw.lastIndexOf('@')
  if (at <= 0) return null
  const local = raw.slice(0, at).replace(/[^a-z0-9]/g, '')
  const labels = raw.slice(at + 1).split('.')
    .map((l) => l.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
  if (!local || !labels.length) return null
  if (labels.length === 1) return `${local}-${labels[0]}`
  const domain = labels.slice(0, -1).join('')
  const tld = labels[labels.length - 1]
  return withTld ? `${local}-${domain}-${tld}` : `${local}-${domain}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Could this URL segment be a slug at all? Dash-joined lowercase alphanumeric
 * runs — but never a UUID, which the resolver must treat as an id directly
 * (no list round-trip). Excluded by shape, not charset: an email would have to
 * hash out to exactly 8-4-4-4-12 hex runs to collide, which is not a case
 * worth designing for beyond this check — resolution tries exact ids first
 * anyway, so even that contrivance could not open the wrong resume.
 */
export function isSlugSegment(segment: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segment) && !UUID_RE.test(segment)
}

/** Both spellings of a candidate's address, shortest first. Empty without an email. */
function slugsOf(c: SlugCandidate): string[] {
  if (!c.email) return []
  const short = emailSlug(c.email, false)
  const full = emailSlug(c.email, true)
  if (!short || !full) return []
  return short === full ? [short] : [short, full]
}

/**
 * The URL segment to SHOW for `id`: the short slug when no other visible
 * resume answers to it, the full-domain slug when the short one collides, and
 * the plain id when even that is taken (two resumes for one email) or there is
 * no usable email. A candidate collides if it equals EITHER spelling of any
 * other resume — resolution matches both, so any overlap is ambiguity.
 */
export function preferredSegment(all: readonly SlugCandidate[], id: string): string {
  const me = all.find((c) => c.id === id)
  if (!me) return id
  const others = new Set(all.filter((c) => c.id !== id).flatMap(slugsOf))
  for (const candidate of slugsOf(me)) {
    if (!others.has(candidate)) return candidate
  }
  return id
}

/**
 * Which resume a URL segment means: an exact id wins outright, else the one
 * resume whose short or full slug matches. Null when nothing (or more than
 * one thing) answers — the caller treats that as an unknown address.
 */
export function resolveSegment(all: readonly SlugCandidate[], segment: string): string | null {
  const exact = all.find((c) => c.id === segment)
  if (exact) return exact.id
  if (!isSlugSegment(segment)) return null
  const matches = all.filter((c) => slugsOf(c).includes(segment))
  return matches.length === 1 ? matches[0].id : null
}
