/**
 * The Settings tab list — an ARIA tablist with roving focus.
 *
 * Rendered as a vertical rail beside the panel at ordinary widths. On narrow
 * screens a rail would starve the panel, so the tablist hides behind a
 * disclosure button instead (a "burger" — CSS shows/hides it, so this
 * component doesn't need to know the viewport width): tapping it pops the
 * FULL vertical list out as an overlay. A horizontal scrolling bar was tried
 * first and rejected — it gives no overview of what's available, only of
 * whatever fits before the fold. The popout is a vertical list for the same
 * reason the wide rail is: you can see every option at once.
 *
 * Because both layouts stack vertically, arrow keys always move along the
 * vertical axis (Up/Down) — there's no orientation to detect. Only the
 * visibility mechanics differ, and CSS owns those (see SettingsModal's
 * `.sm-tabs` / `.sm-burger` rules).
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Menu, ChevronDown } from 'lucide-react'

export interface TabDef {
  id: string
  label: string
}

interface Props {
  tabs: TabDef[]
  active: string
  onChange: (id: string) => void
}

export function SettingsTabs({ tabs, active, onChange }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Only meaningful at narrow widths — the burger that opens it is
  // CSS-hidden at ordinary widths, so this can never become true there.
  const [open, setOpen] = useState(false)

  // Close on outside click; Escape closes and returns focus to the trigger —
  // the same disclosure idiom as the header's resume switcher.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Popping the list open lands focus on the SELECTED tab — the one already
  // in the roving tab order — rather than leaving it on the trigger, so
  // arrow keys work immediately.
  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
  }, [open])

  /** Select a tab and, if the popout is open, close it — that's what "select" means there. */
  const selectTab = (id: string) => {
    onChange(id)
    setOpen(false)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active)
    let next: number
    if (e.key === 'ArrowDown') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowUp') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else return
    e.preventDefault()
    onChange(tabs[next].id)
    // Follow focus, as the tabs pattern expects for automatic activation.
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  const activeLabel = tabs.find((t) => t.id === active)?.label ?? 'Settings'

  return (
    <div className="sm-nav" ref={navRef}>
      {/* Narrow-width only (CSS-hidden otherwise). Disclosure, not an ARIA
          menu: it reveals a real tablist, so aria-expanded + aria-controls
          carry the state rather than a menu role over-promising. */}
      <button
        ref={triggerRef}
        type="button"
        className="sm-burger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="sm-tablist"
      >
        <Menu size={14} />
        <span className="sm-burger-label">{activeLabel}</span>
        <ChevronDown size={14} className={open ? 'sm-burger-chev open' : 'sm-burger-chev'} />
      </button>

      {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus -- a tablist is NOT focusable; the selected tab is, and it delegates arrow keys to it (WAI-ARIA APG) */}
      <div
        className={open ? 'sm-tabs is-open' : 'sm-tabs'}
        id="sm-tablist"
        role="tablist"
        aria-label="Settings sections"
        aria-orientation="vertical"
        ref={listRef}
        onKeyDown={onKeyDown}
      >
        {tabs.map((t) => {
          const selected = t.id === active
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`sm-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`sm-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              className={`sm-tab ${selected ? 'is-active' : ''}`}
              onClick={() => selectTab(t.id)}
            >
              {t.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
