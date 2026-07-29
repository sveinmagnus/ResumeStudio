/**
 * Translate accepted achievements into the other editing language before they
 * are written.
 *
 * A CV maintained in two languages has to STAY maintained in two languages. An
 * accepted highlight that lands only in the primary column makes the secondary
 * version of the CV quietly say less than the primary one, and nothing surfaces
 * that until an export goes out in the wrong language.
 *
 * Best-effort by design: no translation backend configured, or a call that
 * fails, means the achievement is still applied — in one language, which is
 * what would have happened anyway. Losing an accepted suggestion because a
 * translator was down would be a much worse trade.
 *
 * Uses the ordinary Draft path, so it carries the C3 glossary and renders terms
 * the way the rest of the CV already renders them.
 */

import { api } from './api'
import { glossaryFor } from './glossary'
import type { ResumeStore } from '../types'
import type { Achievement } from './achievementMining'

/**
 * Fill each achievement's `translations[secondary]`. Returns a new array; the
 * input is untouched.
 */
export async function translateAchievements(
  data: ResumeStore,
  items: readonly Achievement[],
  primary: string,
  secondary: string | null,
): Promise<Achievement[]> {
  if (!secondary || secondary === primary || !items.length) return [...items]

  const one = async (text: string): Promise<string> => {
    const source = text.trim()
    if (!source) return ''
    try {
      return (await api.translate(source, primary, secondary, glossaryFor(data, primary, secondary, source))).trim()
    } catch {
      return ''
    }
  }

  return Promise.all(items.map(async (a) => {
    const [text, detail] = await Promise.all([one(a.text), one(a.detail)])
    if (!text && !detail) return a
    return {
      ...a,
      translations: { ...a.translations, [secondary]: { text, detail } },
    }
  }))
}
