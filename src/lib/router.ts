/**
 * Tiny History API router — only what this app actually needs.
 *
 * Routes:
 *   /          → picker (ResumeList)
 *   /r/:id     → editor shell for one resume
 *
 * Provides:
 *   - useRoute()  — re-renders subscribers on every URL change.
 *   - navigate(to) — programmatic navigation (pushState + emit).
 *   - <Link>      — anchor with onClick wired to navigate().
 *
 * No dep. If we ever need nested routes (e.g. shareable view links) the same
 * hook extends — just add another match arm to `parseRoute`.
 */

import {
  createElement,
  useEffect,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from 'react'

export type Route =
  | { name: 'picker' }
  | { name: 'editor'; id: string }
  | { name: 'not-found'; path: string }

// ─── URL ↔ Route ─────────────────────────────────────────────────────────────

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'picker' }
  const m = /^\/r\/([^/]+)\/?$/.exec(pathname)
  if (m) return { name: 'editor', id: decodeURIComponent(m[1]) }
  return { name: 'not-found', path: pathname }
}

export function pathFor(route: Route): string {
  switch (route.name) {
    case 'picker': return '/'
    case 'editor': return `/r/${encodeURIComponent(route.id)}`
    case 'not-found': return route.path
  }
}

// ─── Subscription plumbing ───────────────────────────────────────────────────

type Listener = () => void
const listeners = new Set<Listener>()

function emit(): void {
  for (const l of listeners) l()
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', emit)
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
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to, { replace })
  }
  return createElement('a', { href, onClick: handleClick, ...rest }, children)
}

/**
 * Imperatively redirect on mount. Useful inside route bodies for things like
 * "if no such resume, send the user home".
 */
export function useRedirect(to: string | Route, opts?: { replace?: boolean }): void {
  useEffect(() => {
    navigate(to, opts)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
