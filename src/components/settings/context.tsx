/**
 * Shared state for the Settings tabs.
 *
 * The settings screen is ONE form with one Save — the tabs only decide what's
 * on screen, not what's saved — so the state stays in `SettingsModal` and the
 * tabs read it from here. A context rather than props because the alternative
 * is a 25-prop signature on every tab, re-typed in two places; nothing here is
 * shared beyond the modal subtree, so the usual "context is global state"
 * objection doesn't apply.
 */

import { createContext, useContext } from 'react'
import type { SettingsStatus, UpdateStatus, DockerActionResult } from '../../lib/api'
import type { ModelOption } from '../../lib/modelPicker'

/** The translation provider as the UI models it (Docker vs remote are one provider server-side). */
export type UiProvider = 'off' | 'libre_docker' | 'libre_remote' | 'deepl' | 'google' | 'azure' | 'llm'
/** Same idea for the summarize provider (Ollama's Docker vs remote is one
 *  provider server-side; the hosted ones map 1:1 to SummarizeProvider). */
export type LlmUiProvider =
  | 'off' | 'ollama_docker' | 'ollama_remote'
  | 'openai' | 'anthropic' | 'gemini' | 'mistral' | 'compat'

/** API-key form fields for the summarize providers that take a key. */
export interface LlmKeys { openai: string; anthropic: string; gemini: string; mistral: string; compat: string }
export type LlmKeyName = keyof LlmKeys

/** An async action's transient result (Test / Docker / update buttons). */
export interface ActionState { busy: boolean; text?: string; ok?: boolean }

export interface SettingsForm {
  status: SettingsStatus | null
  managed: boolean
  keyPlaceholder: (set: boolean) => string

  // ── Translation ──
  provider: UiProvider
  setProvider: (v: UiProvider) => void
  libreUrl: string
  setLibreUrl: (v: string) => void
  azureRegion: string
  setAzureRegion: (v: string) => void
  keys: { libre: string; deepl: string; google: string; azure: string }
  setKeys: React.Dispatch<React.SetStateAction<{ libre: string; deepl: string; google: string; azure: string }>>
  keySet: { libre: boolean; deepl: boolean; google: boolean; azure: boolean }
  docker: ActionState
  onDocker: (action: 'start' | 'stop' | 'status') => Promise<void>
  test: ActionState
  onTest: () => Promise<void>
  transLangs: string[]
  setTransLangs: React.Dispatch<React.SetStateAction<string[]>>
  forcedLangs: string[]

  // ── Summarize (AI assist) ──
  llmProvider: LlmUiProvider
  setLlmProvider: (v: LlmUiProvider) => void
  llmOllamaUrl: string
  setLlmOllamaUrl: (v: string) => void
  llmCompatUrl: string
  setLlmCompatUrl: (v: string) => void
  llmModel: string
  /** Also re-suggests `llmHighEnd` until the user overrides it (SettingsModal). */
  setLlmModel: (v: string) => void
  /** "This model is high-end" — the gate on the advanced assists. */
  llmHighEnd: boolean
  setLlmHighEnd: (v: boolean) => void
  llmKeys: LlmKeys
  setLlmKeys: React.Dispatch<React.SetStateAction<LlmKeys>>
  llmKeySet: Record<LlmKeyName, boolean>
  llmTest: ActionState
  onTestLlm: () => Promise<void>
  llmDocker: ActionState
  onOllamaDocker: (action: 'start' | 'stop' | 'status') => Promise<DockerActionResult | void>
  isOllama: boolean
  /** The model pick-list: what the provider reports, plus Ollama download sizes. */
  modelOpts: ModelOption[]
  modelsBusy: boolean
  refreshModels: () => Promise<void>

  // ── Local address ──
  /** `.local`/`.localhost` name for this machine; empty = use the IP. */
  localHostname: string
  setLocalHostname: (v: string) => void
  /** Pinned port, or 0 for the automatic 80-then-1923 ladder. */
  localPort: number
  setLocalPort: (v: number) => void

  // ── Sync ──
  backupDir: string
  setBackupDir: (v: string) => void

  // ── Version & updates ──
  upd: UpdateStatus | null
  updBusy: null | 'check' | 'install'
  onCheckUpdate: () => Promise<void>
  onInstallUpdate: () => Promise<void>
}

const Ctx = createContext<SettingsForm | null>(null)

export const SettingsFormProvider = Ctx.Provider

export function useSettingsForm(): SettingsForm {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSettingsForm must be used inside the Settings modal')
  return v
}
