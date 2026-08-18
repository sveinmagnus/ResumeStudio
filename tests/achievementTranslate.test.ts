/**
 * A4's translation step: an accepted achievement has to land in BOTH language
 * columns, or the secondary version of the CV quietly says less than the
 * primary and nothing surfaces it until an export goes out.
 *
 * Best-effort by design — a missing or failing translator still applies the
 * achievement in one language, which is what would have happened anyway.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { translateAchievements } from '../src/lib/achievementTranslate'
import { api } from '../src/lib/api'
import { emptyStore } from './fixtures'
import type { Achievement } from '../src/lib/achievementMining'

const achievement = (over: Partial<Achievement> = {}): Achievement => ({
  key: 'k1', target: 'highlight', section: 'projects', itemId: 'p1',
  itemLabel: 'Acme', text: 'Cut release time to a day', detail: '',
  evidence: 'We moved from weekly to daily releases.', ...over,
})

beforeEach(() => { vi.restoreAllMocks() })

describe('translateAchievements()', () => {
  it('fills the secondary column from the translator', async () => {
    vi.spyOn(api, 'translate').mockResolvedValue('Kuttet releasetid til én dag')
    const [out] = await translateAchievements(emptyStore(), [achievement()], 'en', 'no')
    expect(out.translations?.no).toEqual({ text: 'Kuttet releasetid til én dag', detail: '' })
  })

  it('translates the competency detail as well as the title', async () => {
    vi.spyOn(api, 'translate').mockImplementation(async (text: string) => `NO:${text}`)
    const [out] = await translateAchievements(
      emptyStore(),
      [achievement({ target: 'competency', text: 'Delivery cadence', detail: 'Owns the release train.' })],
      'en', 'no',
    )
    expect(out.translations?.no).toEqual({
      text: 'NO:Delivery cadence', detail: 'NO:Owns the release train.',
    })
  })

  it('asks the translator for the language pair being edited', async () => {
    const translate = vi.spyOn(api, 'translate').mockResolvedValue('x')
    await translateAchievements(emptyStore(), [achievement()], 'en', 'se')
    expect(translate.mock.calls[0][1]).toBe('en')
    expect(translate.mock.calls[0][2]).toBe('se')
  })

  it('does nothing at all without a second language', async () => {
    // No secondary, or the same language twice: there is nothing to translate,
    // and calling a backend would spend a request to learn that.
    const translate = vi.spyOn(api, 'translate').mockResolvedValue('x')
    const items = [achievement()]

    expect(await translateAchievements(emptyStore(), items, 'en', null)).toEqual(items)
    expect(await translateAchievements(emptyStore(), items, 'en', 'en')).toEqual(items)
    expect(await translateAchievements(emptyStore(), [], 'en', 'no')).toEqual([])
    expect(translate).not.toHaveBeenCalled()
  })

  it('returns the achievement unchanged when the translator fails', async () => {
    // Losing an accepted suggestion because a translator was down is a far
    // worse trade than applying it in one language.
    vi.spyOn(api, 'translate').mockRejectedValue(new Error('offline'))
    const [out] = await translateAchievements(emptyStore(), [achievement()], 'en', 'no')
    expect(out.translations).toBeUndefined()
    expect(out.text).toBe('Cut release time to a day')
  })

  it('does not call the translator for an empty field', async () => {
    // A highlight carries no detail; sending '' would burn a request per
    // accepted item and can come back as something non-empty.
    const translate = vi.spyOn(api, 'translate').mockResolvedValue('x')
    await translateAchievements(emptyStore(), [achievement({ detail: '   ' })], 'en', 'no')
    expect(translate).toHaveBeenCalledTimes(1)
    expect(translate.mock.calls[0][0]).toBe('Cut release time to a day')
  })

  it('keeps translations already present for other languages', async () => {
    vi.spyOn(api, 'translate').mockResolvedValue('Svensk')
    const existing = achievement({ translations: { no: { text: 'Norsk', detail: '' } } })
    const [out] = await translateAchievements(emptyStore(), [existing], 'en', 'se')
    expect(out.translations?.no).toEqual({ text: 'Norsk', detail: '' })
    expect(out.translations?.se).toEqual({ text: 'Svensk', detail: '' })
  })

  it('leaves the input array untouched', async () => {
    vi.spyOn(api, 'translate').mockResolvedValue('Norsk')
    const items = [achievement()]
    await translateAchievements(emptyStore(), items, 'en', 'no')
    expect(items[0].translations).toBeUndefined()
  })

  it('trims what the translator returns', async () => {
    vi.spyOn(api, 'translate').mockResolvedValue('  Kuttet releasetid  ')
    const [out] = await translateAchievements(emptyStore(), [achievement()], 'en', 'no')
    expect(out.translations?.no.text).toBe('Kuttet releasetid')
  })
})

describe('translateAchievements — when the translator fails', () => {
  it('leaves the achievement untouched when every call rejects', () => {
    // Best-effort is the contract: the achievement still applies in the primary
    // language. A failed translation must add NO secondary entry at all — an
    // empty one would overwrite the other column with blanks on apply.
    vi.spyOn(api, 'translate').mockRejectedValue(new Error('offline'))
    return translateAchievements(emptyStore(), [achievement()], 'en', 'no').then(([out]) => {
      expect(out.translations?.no).toBeUndefined()
    })
  })

  it('still records the half that succeeded', () => {
    // The title and the detail are translated independently; losing one must not
    // discard the other.
    vi.spyOn(api, 'translate').mockImplementation(((text: string) =>
      text.startsWith('Cut') ? Promise.resolve('Kuttet') : Promise.reject(new Error('offline'))) as never)
    return translateAchievements(
      emptyStore(), [achievement({ detail: 'Some detail' })], 'en', 'no',
    ).then(([out]) => {
      expect(out.translations?.no).toEqual({ text: 'Kuttet', detail: '' })
    })
  })
})
