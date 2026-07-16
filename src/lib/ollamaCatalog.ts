/**
 * PURE: a curated starting list of open-weight chat models for the local
 * (Docker-managed Ollama) Summarize backend, so the model field is a pick-list
 * instead of a free-text box you have to already know the answer for.
 *
 * Deliberately NOT exhaustive: Ollama's registry has thousands of tags and no
 * public "list everything" API worth shipping against. This is the shortlist
 * that suits the job — summarising one paragraph into one line — ordered by
 * PARAMETER COUNT ascending, because that task does not need a big model and
 * small is the right default. (Download size is shown but isn't the sort key:
 * it isn't monotonic across families, since quantisation differs — qwen2.5:1.5b
 * downloads smaller than llama3.2:1b.) The field stays free-text, so any valid tag
 * (`ollama pull` name) still works; `GET /api/summarize/models` merges in
 * whatever the running instance has actually pulled.
 *
 * `sizeGb` is the approximate DOWNLOAD size of the default quantisation, for
 * setting expectations before a multi-GB pull — rounded, and rendered with a
 * "~". `params` is the parameter count, which is definitional from the tag.
 */

export interface OllamaCatalogEntry {
  /** The `ollama pull` tag. */
  name: string
  /** Parameter count as advertised by the tag (e.g. '3B'). */
  params: string
  /** Approximate download size in GB for the default quantisation. */
  sizeGb: number
  /** Why you'd pick it — one short clause. */
  note?: string
}

export const OLLAMA_CATALOG: readonly OllamaCatalogEntry[] = [
  { name: 'qwen2.5:0.5b', params: '0.5B', sizeGb: 0.4, note: 'smallest — fastest, roughest' },
  { name: 'llama3.2:1b', params: '1B', sizeGb: 1.3 },
  { name: 'qwen2.5:1.5b', params: '1.5B', sizeGb: 1.0 },
  { name: 'gemma2:2b', params: '2B', sizeGb: 1.6 },
  { name: 'llama3.2:3b', params: '3B', sizeGb: 2.0, note: 'good default for summarising' },
  { name: 'qwen2.5:3b', params: '3B', sizeGb: 1.9 },
  { name: 'phi3.5:3.8b', params: '3.8B', sizeGb: 2.2 },
  { name: 'mistral:7b', params: '7B', sizeGb: 4.1 },
  { name: 'qwen2.5:7b', params: '7B', sizeGb: 4.7 },
  { name: 'llama3.1:8b', params: '8B', sizeGb: 4.7, note: 'strongest here — slowest, largest' },
  { name: 'gemma2:9b', params: '9B', sizeGb: 5.4 },
]

/** Format bytes (from Ollama's /api/tags) as a compact "~1.9 GB". */
export function fmtModelSize(bytes: number): string {
  if (!(bytes > 0)) return ''
  const gb = bytes / 1e9
  return gb >= 1 ? `~${gb.toFixed(1)} GB` : `~${Math.round(bytes / 1e6)} MB`
}

/** A model the running Ollama has already pulled. */
export interface InstalledModel {
  name: string
  /** Size on disk in bytes, when the instance reported one. */
  size?: number
}

export interface ModelOption {
  name: string
  /** Right-hand descriptor for the datalist entry (size / params / status). */
  label: string
  installed: boolean
}

/**
 * Merge what the instance has pulled with the curated shortlist into one
 * pick-list. Installed models come FIRST (they need no download and are the
 * likely intent) and are marked as such; catalog entries the user hasn't pulled
 * follow, with their download size so the cost is visible before committing.
 * An installed model that isn't in the catalog still appears — that's the whole
 * point of the refresh.
 */
export function modelOptions(installed: readonly InstalledModel[]): ModelOption[] {
  const seen = new Set<string>()
  const out: ModelOption[] = []

  for (const m of installed) {
    const name = m.name.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    const size = m.size ? fmtModelSize(m.size) : ''
    out.push({ name, label: ['Installed', size].filter(Boolean).join(' · '), installed: true })
  }

  for (const c of OLLAMA_CATALOG) {
    if (seen.has(c.name)) continue
    seen.add(c.name)
    const bits = [c.params, `~${c.sizeGb.toFixed(1)} GB download`]
    if (c.note) bits.push(c.note)
    out.push({ name: c.name, label: bits.join(' · '), installed: false })
  }
  return out
}
