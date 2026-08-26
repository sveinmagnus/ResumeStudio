/**
 * The Settings tab list — an ARIA tablist with roving focus.
 *
 * Rendered as a vertical rail beside the panel (the tab set outgrew the
 * modal's width as a horizontal bar), flipping back to a horizontal bar on
 * narrow screens where a side rail would starve the panel. Arrow keys move
 * between tabs along the VISUAL axis and Home/End jump to the ends (WAI-ARIA
 * tabs pattern); only the selected tab is in the Tab order, so Tab from the
 * list goes straight into the panel rather than walking every tab first.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

export interface TabDef {
  id: string
  label: string
}

interface Props {
  tabs: TabDef[]
  active: string
  onChange: (id: string) => void
}

/** Where the rail flips horizontal. Must match `.sm-layout`'s media query. */
const NARROW_QUERY = '(max-width: 640px)'

export function SettingsTabs({ tabs, active, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // aria-orientation and the arrow axis have to follow the LAYOUT, which is
  // CSS's decision — so ask the same media query the stylesheet uses.
  const [vertical, setVertical] = useState(
    () => typeof window.matchMedia === 'function' ? !window.matchMedia(NARROW_QUERY).matches : true,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(NARROW_QUERY)
    const sync = () => setVertical(!mq.matches)
    // `change` is the right signal, but emulated viewports (devtools device
    // mode) have been seen re-evaluating the query without dispatching it —
    // `resize` catches those, and the re-check is cheap.
    mq.addEventListener('change', sync)
    window.addEventListener('resize', sync)
    sync()
    return () => {
      mq.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    const nextKey = vertical ? 'ArrowDown' : 'ArrowRight'
    const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft'
    const i = tabs.findIndex((t) => t.id === active)
    let next: number
    if (e.key === nextKey) next = (i + 1) % tabs.length
    else if (e.key === prevKey) next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else return
    e.preventDefault()
    onChange(tabs[next].id)
    // Follow focus, as the tabs pattern expects for automatic activation.
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return (
    // WAI-ARIA APG: a tablist is NOT focusable; the selected tab is, and the tablist delegates arrow keys to it.
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- see above
    <div
      className="sm-tabs"
      role="tablist"
      aria-label="Settings sections"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      ref={ref}
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
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
