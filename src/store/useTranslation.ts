/**
 * Tiny app-wiring hook exposing whether translation assist is available
 * (i.e. the server has a LibreTranslate instance configured). Lives beside the
 * other store hooks (useUndoRedo, useResumePersistence) by convention.
 *
 * Backed by the memoized probe in lib/translateClient, so mounting many
 * DualFields triggers at most one /api/translate/status request.
 */
import { useEffect, useState } from 'react'
import { getTranslationAvailability } from '../lib/translateClient'
import { getSummarizeAvailability } from '../lib/summarizeClient'

export function useTranslationAvailable(): boolean {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let active = true
    void getTranslationAvailability().then((ok) => {
      if (active) setAvailable(ok)
    })
    return () => { active = false }
  }, [])

  return available
}

/**
 * Whether the server has an LLM summarize backend configured. Backed by the
 * memoized probe in lib/summarizeClient, so many DualFields share one request.
 */
export function useSummarizeAvailable(): boolean {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let active = true
    void getSummarizeAvailability().then((ok) => {
      if (active) setAvailable(ok)
    })
    return () => { active = false }
  }, [])

  return available
}
