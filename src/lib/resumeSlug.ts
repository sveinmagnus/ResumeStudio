/**
 * The readable address a resume is reached at — `/r/sveinsgmail` instead of
 * `/r/6f3a…-…`.
 *
 * The address is DERIVED from the person's email, never stored: an email
 * rarely changes, so the address is stable, and there is no second field that
 * can drift out of sync with the first. Two spellings exist per email —
 * `local + domain-without-TLD` (`sveins@gmail.com` → `sveinsgmail`), and the
 * full-domain form (`sveinsgmailcom`) as the collision escape when two people
 * in the org share the short one. Both are compact and symbol-free: lowercase
 * `a–z0–9` only, so a slug can never be mistaken for a UUID (those always
 * carry hyphens) and never needs URL-encoding.
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
 * or nothing alphanumeric survives on either side). `withTld: false` drops the
 * domain's final label (`gmail.com` → `gmail`); a single-label domain keeps
 * its one label, since dropping it would erase the domain entirely.
 */
export function emailSlug(email: string, withTld: boolean): string | null {
  const at = email.trim().toLowerCase().lastIndexOf('@')
  if (at <= 0) return null
  const raw = email.trim().toLowerCase()
  const local = raw.slice(0, at).replace(/[^a-z0-9]/g, '')
  const labels = raw.slice(at + 1).split('.')
    .map((l) => l.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
  if (!local || !labels.length) return null
  const domain = (withTld || labels.length === 1 ? labels : labels.slice(0, -1)).join('')
  if (!domain) return null
  return local + domain
}

/** Could this URL segment be a slug at all? (A UUID never can — it has hyphens.) */
export function isSlugSegment(segment: string): boolean {
  return /^[a-z0-9]+$/.test(segment)
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
