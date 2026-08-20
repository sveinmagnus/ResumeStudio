/**
 * Tiny History API router — only what this app actually needs.
 *
 * Routes:
 *   /                     → picker (ResumeList)
 *   /r/:id                → editor shell for one resume (Overview)
 *   /r/:id/:section       → editor with a section selected
 *   /r/:id/views/:viewId  → the Resume Views section with one view open
 *   /reset /accept /verify-email /forgot /recover → account screens reached
 *                           WITHOUT a session (a reset link is followed by
 *                           definition by somebody who cannot sign in)
 *   /profile /admin       → account screens that need one
 *
 * The account screens carry their token in the QUERY string, which this router
 * deliberately does not parse: `getSnapshot` keys on `pathname` alone, and
 * widening it would change what `navigate` treats as "already here". Each
 * screen reads `location.search` itself, once, on mount — which is all a
 * one-shot link needs.
 *
 * Provides:
 *   - useRoute()  — re-renders subscribers on every URL change.
 *   - navigate(to) — programmatic navigation (pushState + emit).
 *   - <Link>      — anchor with onClick wired to navigate().
 *
 * The router does NOT validate section/view tokens — it parses any segment
 * and the editor route reconciles (unknown section → redirect to the resume
 * root). Keeps the router dependency-free.
 */

import {
  createElement,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from 'react'

/**
 * The account screens, each at its own top-level path.
 *
 * The first five are PUBLIC: they must render outside the sign-in gate, because
 * everyone who reaches them is by definition unable to sign in. The last two
 * need a session.
 */
export const PUBLIC_ACCOUNT_SCREENS = ['reset', 'accept', 'verify-email', 'forgot', 'recover'] as const
const PRIVATE_ACCOUNT_SCREENS = ['profile', 'admin'] as const

export type AccountScreen =
  | typeof PUBLIC_ACCOUNT_SCREENS[number]
  | typeof PRIVATE_ACCOUNT_SCREENS[number]

const ACCOUNT_SCREENS: readonly string[] = [...PUBLIC_ACCOUNT_SCREENS, ...PRIVATE_ACCOUNT_SCREENS]

export function isPublicAccountScreen(screen: AccountScreen): boolean {
  return (PUBLIC_ACCOUNT_SCREENS as readonly string[]).includes(screen)
}

export type Route =
  | { name: 'picker' }
  | { name: 'editor'; id: string; section?: string; viewId?: string }
  | { name: 'account'; screen: AccountScreen }
  | { name: 'not-found'; path: string }

// ─── URL ↔ Route ─────────────────────────────────────────────────────────────

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'picker' }
  const account = pathname.replace(/^\/|\/$/g, '')
  if (ACCOUNT_SCREENS.includes(account)) {
    return { name: 'account', screen: account as AccountScreen }
  }
  const m = /^\/r\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?\/?$/.exec(pathname)
  if (m) {
    // decodeURIComponent throws URIError on malformed escapes (e.g. "/r/%").
    // parseRoute runs in useRoute()'s render path, which is NOT inside the
    // editor's ErrorBoundary — an unhandled throw here white-screens the whole
    // app. Treat an undecodable id as "no such route" rather than crashing.
    try {
      const id = decodeURIComponent(m[1])
      if (m[2] === 'views' && m[3]) {
        return { name: 'editor', id, section: 'views', viewId: decodeURIComponent(m[3]) }
      }
      // A third segment is only meaningful under /views/.
      if (m[3]) return { name: 'not-found', path: pathname }
      if (m[2]) return { name: 'editor', id, section: decodeURIComponent(m[2]) }
      return { name: 'editor', id }
    } catch {
      return { name: 'not-found', path: pathname }
    }
  }
  return { name: 'not-found', path: pathname }
}

export function pathFor(route: Route): string {
  switch (route.name) {
    case 'picker': return '/'
    case 'editor': {
      const base = `/r/${encodeURIComponent(route.id)}`
      if (route.section === 'views' && route.viewId) {
        return `${base}/views/${encodeURIComponent(route.viewId)}`
      }
      // Overview is the editor's default — keep its URL canonical (no suffix).
      if (route.section && route.section !== 'overview') {
        return `${base}/${encodeURIComponent(route.section)}`
      }
      return base
    }
    case 'account': return `/${route.screen}`
    case 'not-found': return route.path
  }
}

// ─── Subscription plumbing ───────────────────────────────────────────────────

type Listener = () => void
const listeners = new Set<Listener>()

function emit(): void {
  for (const l of listeners) l()
}

// ─── Per-entry UI state (scroll + which item was open) ──────────────────────
//
// The History API restores neither for a pushState app. Jumping from an
// advisor finding into the item it's about and pressing Back therefore landed
// you at the top of a collapsed list — having lost both your place and the
// thing you were looking at.
//
// So each history entry carries a snapshot: before pushing a new one we
// `replaceState` the CURRENT entry with where the user was, and on `popstate`
// the browser hands that snapshot back. The router doesn't know what "the open
// item" is, so the app registers a capture function.

export interface HistoryUiState {
  scrollY: number
  /** The expanded editor card, so Back reopens what you came from. */
  expandedItemId: string | null
}

/**
 * Stamp the CURRENT entry with where the user is, without adding history.
 *
 * Called as the user scrolls and opens cards rather than at `navigate()` time,
 * because by then it is too late: clicking a section in the sidebar sets the
 * active section first, and `setActiveSection` clears the expanded card — so a
 * snapshot taken during navigation always recorded "nothing open".
 */
export function stampHistoryState(ui: HistoryUiState): void {
  if (typeof window === 'undefined') return
  const current = (window.history.state as { ui?: HistoryUiState } | null)?.ui
  if (current && current.scrollY === ui.scrollY && current.expandedItemId === ui.expandedItemId) return
  try {
    window.history.replaceState(
      { ...(window.history.state as object | null), ui },
      '',
      window.location.pathname,
    )
  } catch {
    /* replaceState can throw under exotic sandboxing — navigation matters more */
  }
}

let pendingRestore: HistoryUiState | null = null

/**
 * The snapshot for the entry we just navigated BACK to, consumed once.
 * Returns null for a forward navigation, which must not restore anything —
 * arriving somewhere new should start at the top.
 */
export function takePendingRestore(): HistoryUiState | null {
  const p = pendingRestore
  pendingRestore = null
  return p
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    const state = e.state as { ui?: HistoryUiState } | null
    pendingRestore = state?.ui ?? null
    emit()
  })
}

function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

function getSnapshot(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname
}

// ─── Public hook ─────────────────────────────────────────────────────────────

/**
 * Re-renders when the URL changes (push/replace via `navigate`, or browser
 * back/forward). Returns the parsed Route.
 */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return parseRoute(pathname)
}

/**
 * Programmatic navigation. `to` is either a path string or a Route object.
 * `replace=true` uses `replaceState` instead of `pushState` (e.g. for
 * redirects that shouldn't pollute history).
 */
export function navigate(to: string | Route, opts?: { replace?: boolean }): void {
  if (typeof window === 'undefined') return
  const target = typeof to === 'string' ? to : pathFor(to)
  if (target === window.location.pathname) return
  // The entry we're leaving is already stamped (see stampHistoryState), so
  // there is nothing to capture here.
  if (opts?.replace) window.history.replaceState({}, '', target)
  else window.history.pushState({}, '', target)
  emit()
}

// ─── <Link> component ────────────────────────────────────────────────────────

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string | Route
  replace?: boolean
}

/**
 * Is this the click that should navigate IN PLACE?
 *
 * Ctrl/Cmd-click, Shift-click and middle-click mean "open this somewhere else",
 * and the browser handles them itself. Anything a `<Link>` does on top of
 * navigation — closing a drawer, selecting a section — must ask this first, or
 * opening a section in a second tab also moves the tab you're still reading.
 */
export function isPlainLeftClick(e: MouseEvent<HTMLElement>): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}

/**
 * In-app anchor. Renders a normal <a> so right-click "Open in new tab" works,
 * but intercepts plain left-clicks to use the History API instead of a full
 * page navigation.
 */
export function Link({ to, replace, onClick, children, ...rest }: LinkProps) {
  const href = typeof to === 'string' ? to : pathFor(to)
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented) return
    // Let the browser handle anything that isn't a plain left-click.
    if (!isPlainLeftClick(e)) return
    e.preventDefault()
    navigate(to, { replace })
  }
  return createElement('a', { href, onClick: handleClick, ...rest }, children)
}

