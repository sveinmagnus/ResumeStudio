/**
 * PURE: the one pick-list behind the settings model field, for every provider.
 *
 * Merges what the provider actually reports (live, via `/api/llm/models`) with
 * the local Ollama catalog's download sizes. Live entries come FIRST: they are
 * real ids this key can run today, which is the whole point of asking.
 */

import { OLLAMA_CATALOG, fmtModelSize, type InstalledModel } from './ollamaCatalog'

/** One row in the picker. */
export interface ModelOption {
  name: string
  /** Right-hand descriptor — availability, size, or the provider's own label. */
  label: string
  /** True when the provider reported it (vs. a catalog entry to download). */
  available: boolean
}

/** A model as the server reports it. */
export interface LiveModel {
  id: string
  label?: string
}

const isOllama = (p: string) => p === 'ollama_docker' || p === 'ollama_remote'

/**
 * Build the list. For Ollama, `live` is what the instance has PULLED, so the
 * curated catalog is appended with download sizes — the cost of a model you
 * don't have yet is worth seeing before you commit to it. For hosted providers
 * the live list is the whole answer; there is no offline catalog any more (see
 * cloudModelCatalog.ts for why).
 */
export function buildModelOptions(provider: string, live: readonly LiveModel[]): ModelOption[] {
  const seen = new Set<string>()
  const out: ModelOption[] = []

  for (const m of live) {
    const name = m.id.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push({
      name,
      label: m.label ?? (isOllama(provider) ? 'Installed' : 'Available'),
      available: true,
    })
  }

  if (isOllama(provider)) {
    for (const c of OLLAMA_CATALOG) {
      if (seen.has(c.name)) continue
      seen.add(c.name)
      out.push({
        name: c.name,
        label: [c.params, `~${c.sizeGb.toFixed(1)} GB download`].filter(Boolean).join(' · '),
        available: false,
      })
    }
  }

  return out
}

/** Ollama's `/api/tags` shape, mapped onto the generic one. */
export function fromInstalled(installed: readonly InstalledModel[]): LiveModel[] {
  return installed.map((m) => ({
    id: m.name,
    label: ['Installed', m.size ? fmtModelSize(m.size) : ''].filter(Boolean).join(' · '),
  }))
}
