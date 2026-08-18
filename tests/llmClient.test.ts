/**
 * The memoised backend probe.
 *
 * Every AI surface asks whether a model is configured, and they ask on render.
 * Without the memo each panel issues its own request, so opening a resume with
 * several assists on screen fires a burst of identical calls at the server — and
 * on the desktop build that server may be starting a local model container.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getAssistStatus, getLlmAvailability, resetLlmAvailability, subscribeAssistStatus,
} from '../src/lib/llmClient'
import { api } from '../src/lib/api'

const status = (over = {}) => ({
  configured: true, provider: 'ollama', model: 'llama3:8b', local: true, highEnd: false, ...over,
})

beforeEach(() => {
  resetLlmAvailability()
  vi.restoreAllMocks()
})

describe('getAssistStatus', () => {
  it('asks the server once, however many callers there are', () => {
    const spy = vi.spyOn(api, 'llmStatus').mockResolvedValue(status() as never)
    return Promise.all([getAssistStatus(), getAssistStatus(), getAssistStatus()]).then((all) => {
      expect(spy).toHaveBeenCalledTimes(1)
      expect(all[0]).toEqual(all[2])
    })
  })

  it('asks again after a reset, because settings may have changed', () => {
    // resetLlmAvailability runs on a settings save; a stale "nothing configured"
    // would leave every assist hidden until a reload.
    const spy = vi.spyOn(api, 'llmStatus').mockResolvedValue(status() as never)
    return getAssistStatus()
      .then(() => { resetLlmAvailability() })
      .then(() => getAssistStatus())
      .then(() => { expect(spy).toHaveBeenCalledTimes(2) })
  })
})

describe('getLlmAvailability', () => {
  it('reports just the configured flag from the same single probe', () => {
    const spy = vi.spyOn(api, 'llmStatus').mockResolvedValue(status({ configured: true }) as never)
    return getLlmAvailability().then((ok) => {
      expect(ok).toBe(true)
      expect(spy).toHaveBeenCalledTimes(1)
    })
  })

  it('is false when the server reports nothing configured', () => {
    vi.spyOn(api, 'llmStatus').mockResolvedValue(status({ configured: false }) as never)
    return getLlmAvailability().then((ok) => { expect(ok).toBe(false) })
  })
})

describe('resetLlmAvailability', () => {
  it('re-probes immediately when something is listening, and not otherwise', () => {
    // With subscribers on screen the answer must refresh itself; with none there
    // is nothing to update, and probing eagerly races whatever set the config.
    const spy = vi.spyOn(api, 'llmStatus').mockResolvedValue(status() as never)
    resetLlmAvailability()
    expect(spy).not.toHaveBeenCalled()

    const unsub = subscribeAssistStatus(() => {})
    const afterSubscribe = spy.mock.calls.length
    resetLlmAvailability()
    expect(spy.mock.calls.length).toBe(afterSubscribe + 1)
    unsub()
  })
})
