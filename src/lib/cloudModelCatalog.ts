/**
 * PURE: what to say in the model field for the HOSTED providers when we have no
 * live list yet.
 *
 * This file used to hold a curated shortlist of model ids per provider. That was
 * a bug factory, and it bit exactly as you'd expect: the Gemini entry outlived
 * the model, so the field confidently suggested `gemini-2.5-flash`, the user
 * picked it, saved, and found out at "Save and test" that it no longer exists.
 * A hardcoded list of someone else's product line-up is wrong the moment they
 * ship, and it fails silently and late.
 *
 * So the ids are gone. `server/llmModels.ts` asks each provider what it
 * currently offers, which is both accurate and self-maintaining. What's left
 * here is the placeholder text and the nudge that gets a user to the live list —
 * information that doesn't go stale.
 *
 * (`ollamaCatalog.ts` legitimately keeps its list: it carries download SIZES for
 * models the instance has NOT pulled, which no endpoint can tell us, and a
 * stopped Ollama has nothing to ask.)
 */

/** Providers whose model list we can fetch once a key is present. */
const LISTABLE = new Set(['openai', 'anthropic', 'gemini', 'mistral', 'compat'])

export function isListableProvider(provider: string): boolean {
  return LISTABLE.has(provider)
}

/**
 * Placeholder for the model input. Deliberately shape-only ("the id your
 * provider uses") rather than a concrete example — a concrete example is a
 * hardcoded model id wearing a disguise, and would rot the same way.
 */
export function modelPlaceholder(provider: string): string {
  if (provider === 'ollama_docker' || provider === 'ollama_remote') return 'e.g. llama3.2:3b'
  return 'Model id — use Refresh to list what your key can run'
}

/** What to tell the user when we have no live list for this provider yet. */
export function noModelsHint(provider: string, hasKey: boolean): string {
  if (provider === 'ollama_docker' || provider === 'ollama_remote') {
    return 'No models pulled yet. Pick one below, or type any Ollama tag.'
  }
  return hasKey
    ? 'Could not reach the provider to list models. Check the key, or type the model id directly.'
    : 'Enter your API key, then press Refresh to list the models it can run.'
}
