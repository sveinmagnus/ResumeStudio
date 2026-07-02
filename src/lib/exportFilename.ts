/**
 * PURE: build a safe download filename for an exported Resume View.
 *
 * A view is free-text ("Backend / DevOps", "Q3 — Client A"), so a naive
 * whitespace-only slug leaves characters that are illegal in Windows filenames
 * (`\ / : * ? " < > |`) or that browsers mangle. This collapses those to `_`,
 * trims separator runs, and guarantees a non-empty stem so `a.download` always
 * gets a usable name. Shared by every export path (PDF/DOCX/text/markdown) so
 * they name files identically.
 */

/** Collapse one free-text part (a name or a view title) into a filename-safe slug. */
export function slugifyFilenamePart(input: string | null | undefined, fallback = 'resume'): string {
  const slug = (input ?? '')
    // Illegal-in-Windows + control chars → separator.
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
    // Avoid a leading/trailing dot (hidden files / extension confusion) or `_` run.
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 80)
  return slug || fallback
}

/**
 * `<name>_<view>.<ext>` with both parts slugified. `ext` is appended verbatim
 * (callers pass a known literal like 'pdf' / 'docx' / 'txt' / 'md').
 */
export function exportFilename(
  fullName: string | null | undefined,
  viewName: string | null | undefined,
  ext: string,
): string {
  return `${slugifyFilenamePart(fullName)}_${slugifyFilenamePart(viewName, 'view')}.${ext}`
}
