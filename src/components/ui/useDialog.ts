import { useEffect, useRef } from 'react'

/**
 * Shared behaviour for the app's overlay dialogs (WCAG 2.1.2 / 2.4.3):
 *
 *   - moves focus INTO the dialog on mount — the first `[data-autofocus]`
 *     element if present, else the first focusable element, else the dialog
 *     itself
 *   - traps Tab / Shift+Tab inside the dialog while it is open
 *   - closes on Escape
 *   - restores focus to the previously-focused element on unmount
 *
 * Attach the returned ref to the dialog CARD (the element with
 * role="dialog" semantics' content), not the backdrop. Backdrop-click
 * close stays the caller's concern.
 *
 * Deliberately a hook rather than the native <dialog> element: these
 * modals render inline in component trees the RTL suites already assert
 * against, and jsdom's showModal support is still patchy.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(onClose: () => void) {
  const ref = useRef<T>(null)
  // Keep the latest callback without re-running the mount effect.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusables = () =>
      Array.from(
        el.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
          'select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], ' +
          '[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((n) => !n.closest('[hidden], [aria-hidden="true"]'))

    const initial = el.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0]
    if (initial) {
      initial.focus()
    } else {
      el.tabIndex = -1
      el.focus()
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const f = focusables()
      if (f.length === 0) {
        e.preventDefault()
        return
      }
      const first = f[0]
      const last = f[f.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || active === el) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    el.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [])

  return ref
}
