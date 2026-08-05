import { describe, it, expect } from 'vitest'
import { isListableProvider, modelPlaceholder, noModelsHint } from '../src/lib/cloudModelCatalog'
import { buildModelOptions, fromInstalled } from '../src/lib/modelPicker'
import { OLLAMA_CATALOG } from '../src/lib/ollamaCatalog'

/**
 * The point of this suite is the NEGATIVE: no hardcoded hosted model id may
 * creep back into the catalog. A curated shortlist is the bug — it suggested
 * `gemini-2.5-flash` long after Google retired it, so the user picked it,
 * saved, and only found out at "Save and test". The live list comes from the
 * provider (`server/llmModels.ts`); what stays here is placeholder text.
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
    // Both Ollama providers, and only those: a hosted provider showing an
    // Ollama tag is the hardcoded-model-id problem coming back in disguise.
    expect(modelPlaceholder('ollama_docker')).toMatch(/llama/i)
    expect(modelPlaceholder('ollama_remote')).toMatch(/llama/i)
    expect(modelPlaceholder('openai')).not.toMatch(/llama/i)
  })

  it('tells an Ollama user to pull a model, not to enter a key', () => {
    for (const p of ['ollama_docker', 'ollama_remote']) {
      // There is no key to enter, so the hosted wording would be a dead end.
      expect(noModelsHint(p, false)).toMatch(/pulled yet/i)
      expect(noModelsHint(p, true)).toMatch(/pulled yet/i)
    }
    expect(noModelsHint('openai', false)).not.toMatch(/pulled yet/i)
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

  it('appends the catalog for the remote Ollama too, not only the Docker one', () => {
    // Both are Ollama; a remote instance has the same pullable tags.
    expect(buildModelOptions('ollama_remote', []).length).toBe(OLLAMA_CATALOG.length)
    expect(buildModelOptions('openai', []).length).toBe(0)
  })

  it('drops a blank or repeated id the server reported', () => {
    // A duplicate id would render two identical rows in the picker, and a blank
    // one an unselectable row.
    const opts = buildModelOptions('gemini', [
      { id: 'gemini-flash-latest' }, { id: '  ' }, { id: 'gemini-flash-latest' },
    ])
    expect(opts.map((o) => o.name)).toEqual(['gemini-flash-latest'])
  })

  it('trims an id before using it as the name', () => {
    expect(buildModelOptions('gemini', [{ id: '  gemini-pro-latest  ' }])[0].name)
      .toBe('gemini-pro-latest')
  })

  it('labels an unlabelled model by where it came from', () => {
    expect(buildModelOptions('gemini', [{ id: 'g' }])[0].label).toBe('Available')
    expect(buildModelOptions('ollama_remote', [{ id: 'g' }])[0].label).toBe('Installed')
  })
})
