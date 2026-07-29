import { describe, it, expect } from 'vitest'
import { isListableProvider, modelPlaceholder, noModelsHint } from '../src/lib/cloudModelCatalog'
import { buildModelOptions, fromInstalled } from '../src/lib/modelPicker'
import { OLLAMA_CATALOG } from '../src/lib/ollamaCatalog'

/**
 * This file used to assert a curated shortlist of hosted model ids. Those ids
 * WERE the bug: the field suggested `gemini-2.5-flash` long after Google moved
 * on, so the user picked it, saved, and only found out at "Save and test" that
 * it no longer exists. The list is fetched from the provider now, and the main
 * thing worth pinning here is that no hardcoded id crept back in.
 */

describe('cloudModelCatalog', () => {
  it('knows which providers can be asked for a model list', () => {
    for (const p of ['openai', 'anthropic', 'gemini', 'mistral', 'compat']) {
      expect(isListableProvider(p)).toBe(true)
    }
    expect(isListableProvider('off')).toBe(false)
  })

  it('never names a specific hosted model id — that is what went stale', () => {
    for (const p of ['openai', 'anthropic', 'gemini', 'mistral', 'compat']) {
      const text = `${modelPlaceholder(p)} ${noModelsHint(p, true)} ${noModelsHint(p, false)}`
      expect(text).not.toMatch(/gpt-|claude-|gemini-|mistral-/)
    }
  })

  it('still gives Ollama a concrete example — its tags are ours to know', () => {
    expect(modelPlaceholder('ollama_docker')).toMatch(/llama/i)
  })

  it('tells the user how to get a list, differently before and after a key', () => {
    expect(noModelsHint('gemini', false)).toMatch(/API key/i)
    expect(noModelsHint('gemini', true)).toMatch(/could not reach/i)
  })
})

describe('buildModelOptions()', () => {
  it('lists what the provider reported, marked available', () => {
    const opts = buildModelOptions('gemini', [{ id: 'gemini-flash-latest' }, { id: 'gemini-pro-latest' }])
    expect(opts.map((o) => o.name)).toEqual(['gemini-flash-latest', 'gemini-pro-latest'])
    expect(opts.every((o) => o.available)).toBe(true)
  })

  it('keeps a provider-supplied label (Anthropic gives display names)', () => {
    const [opt] = buildModelOptions('anthropic', [{ id: 'claude-x', label: 'Claude X' }])
    expect(opt.label).toBe('Claude X')
  })

  /** A hosted provider has no offline catalog to fall back on, by design. */
  it('returns nothing for a hosted provider with no live list', () => {
    expect(buildModelOptions('gemini', [])).toEqual([])
  })

  /**
   * Ollama is the deliberate exception: its catalog carries DOWNLOAD SIZES for
   * models the instance has not pulled, which no endpoint can report.
   */
  it('appends the Ollama catalog with download sizes, installed first', () => {
    const opts = buildModelOptions('ollama_docker', fromInstalled([{ name: 'my-custom:7b', size: 4_200_000_000 }]))
    expect(opts[0]).toMatchObject({ name: 'my-custom:7b', available: true })
    expect(opts[0].label).toMatch(/Installed/)
    expect(opts.length).toBe(1 + OLLAMA_CATALOG.length)
    expect(opts[1].label).toMatch(/GB download/)
    expect(opts[1].available).toBe(false)
  })

  it('does not duplicate a pulled model that is also in the catalog', () => {
    const first = OLLAMA_CATALOG[0].name
    const opts = buildModelOptions('ollama_docker', fromInstalled([{ name: first }]))
    expect(opts.filter((o) => o.name === first)).toHaveLength(1)
    expect(opts[0].available).toBe(true)
  })
})
