/**
 * A one-line channel for "open the Settings dialog, on this tab".
 *
 * The dialog is owned by `AppHeader`, which is nowhere near the places that now
 * want to send you there — the AI advisors block on Overview needs a "set up a
 * model" button, and threading a callback from the header down through Overview
 * and into a card five levels deep to do it would be a prop tunnel nobody
 * wants to maintain.
 *
 * Deliberately tiny and not a store: there is no state here, only an event. The
 * header subscribes; anyone may fire.
 */

export type SettingsTabId = 'version' | 'translation' | 'ai' | 'sync' | 'appearance'

type Listener = (tab: SettingsTabId | undefined) => void

const listeners = new Set<Listener>()

/** Ask for the Settings dialog. `tab` picks which one it opens on. */
export function openSettings(tab?: SettingsTabId): void {
  for (const l of listeners) l(tab)
}

export function onOpenSettings(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
