/**
 * The Settings tab bar — an ARIA tablist with roving focus.
 *
 * Arrow keys move between tabs and Home/End jump to the ends (WAI-ARIA tabs
 * pattern); only the selected tab is in the Tab order, so Tab from the bar goes
 * straight into the panel rather than walking every tab first.
 */

import { useRef, type KeyboardEvent } from 'react'

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
  const ref = useRef<HTMLDivElement>(null)

  const onKeyDown = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active)
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else return
    e.preventDefault()
    onChange(tabs[next].id)
    // Follow focus, as the tabs pattern expects for automatic activation.
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <div className="sm-tabs" role="tablist" aria-label="Settings sections" ref={ref} onKeyDown={onKeyDown}>
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
