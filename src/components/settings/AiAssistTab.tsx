/**
 * AI assist — the ONE model behind every AI feature in the app: summarize, the
 * writing coach, the whole-CV advisors, and (when the Translation tab is set to
 * `llm`) translation too.
 */

import { Loader2, Check, AlertCircle, Server, Box, Power, RefreshCw, Sparkles, Gauge } from 'lucide-react'
import { useSettingsForm, type LlmUiProvider } from './context'
import { cloudModelOptions, modelPlaceholder } from '../../lib/cloudModelCatalog'

export function AiAssistTab() {
  const {
    managed, keyPlaceholder,
    llmProvider, setLlmProvider, llmOllamaUrl, setLlmOllamaUrl,
    llmCompatUrl, setLlmCompatUrl, llmModel, setLlmModel,
    llmHighEnd, setLlmHighEnd,
    llmKeys, setLlmKeys, llmKeySet, llmTest, onTestLlm,
    llmDocker, onOllamaDocker, isOllama, modelOpts, installed, modelsBusy, refreshModels,
    status,
  } = useSettingsForm()

  if (!managed) {
    return (
      <section className="sm-sec">
        <div className="sm-sec-head"><Sparkles size={15} /> AI assist</div>
        <div className="sm-note">
          On this deployment, settings are controlled by the server's environment
          variables, not from the app.
        </div>
        <div className="sm-row">
          <span>AI assist</span>
          <span className={status?.llm?.configured ? 'sm-pill sm-pill-ok' : 'sm-pill'}>
            {status?.llm?.configured ? 'Configured' : 'Off'}
          </span>
        </div>
      </section>
    )
  }

  const installedCount = installed.length
  // Cloud providers map 1:1 to their server name, so the UI value is the catalog
  // key. Ollama has its own (dynamic) list; both feed the same datalist below.
  const cloudModels = cloudModelOptions(llmProvider)
  const hasModelList = isOllama || cloudModels.length > 0

  return (
    <section className="sm-sec">
      <div className="sm-sec-head"><Sparkles size={15} /> AI assist</div>
      <p className="sm-help">
        One LLM powers every AI feature in Resume Studio: <strong>Summarize</strong>{' '}
        (a one-line short description from a long one, per field or a whole section
        at once); the <strong>Writing coach</strong>, which tightens prose without
        inventing facts; tailoring, import and skill suggestions; and — when the
        Translation tab is set to <em>“AI-assist model”</em> —{' '}
        <strong>translation</strong> too. Every result is a review-required draft.
      </p>
      <p className="sm-help">
        Run a model locally with Docker (private &amp; free — nothing leaves this
        computer), or use a hosted provider. Configure it once here and every
        feature lights up.
      </p>

      <label className="sm-field-label" htmlFor="sm-sum-provider">Provider</label>
      <select id="sm-sum-provider" className="sm-input" value={llmProvider}
        onChange={(e) => setLlmProvider(e.target.value as LlmUiProvider)} aria-label="AI assist provider">
        <option value="off">Off — no AI assist</option>
        <optgroup label="Local (private &amp; free)">
          <option value="ollama_docker">Ollama — Docker-managed</option>
          <option value="ollama_remote">Ollama — remote URL</option>
        </optgroup>
        <optgroup label="Hosted (bring your own API key)">
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="gemini">Google Gemini</option>
          <option value="mistral">Mistral</option>
          <option value="compat">Other OpenAI-compatible (OpenRouter, Groq, Together, LM Studio…)</option>
        </optgroup>
      </select>

      {llmProvider !== 'off' && (
        <div className="sm-sub">
          <label className="sm-field-label" htmlFor="sm-sum-model">Model</label>
          {/* A datalist rather than a <select>: Ollama has thousands of
              valid tags, so the list is a shortlist to pick from, not a
              constraint — any tag you type still works. Refresh re-asks
              the running instance what it has pulled. */}
          <div className="sm-field-row">
            <input id="sm-sum-model" className="sm-input" value={llmModel}
              list={hasModelList ? 'sm-model-list' : undefined}
              placeholder={modelPlaceholder(llmProvider)}
              onChange={(e) => setLlmModel(e.target.value)} aria-label="AI assist model" />
            {isOllama && (
              <button className="sm-btn sm-btn-icon" onClick={() => void refreshModels()}
                disabled={modelsBusy} title="Refresh the list from the running Ollama"
                aria-label="Refresh model list">
                {modelsBusy ? <Loader2 size={13} className="sm-spin" /> : <RefreshCw size={13} />}
              </button>
            )}
          </div>
          {hasModelList && (
            <datalist id="sm-model-list">
              {isOllama
                ? modelOpts.map((m) => <option key={m.name} value={m.name} label={m.label} />)
                : cloudModels.map((m) => <option key={m.name} value={m.name} label={m.note} />)}
            </datalist>
          )}
          {isOllama && (
            <p className="sm-help">
              {installedCount > 0
                ? `${installedCount} model(s) already pulled. Others download on first use.`
                : 'Pick a model — smaller is faster and downloads less. Any Ollama tag works.'}
            </p>
          )}
          {!isOllama && cloudModels.length > 0 && (
            <p className="sm-help">Smaller/“mini/flash” models are cheapest and plenty for one-line drafts. Any model id the provider accepts works.</p>
          )}

          {/* The advanced gate. It's a declaration, not a detection: nothing in
              a model name reliably says how capable it is, and a small model
              answers a whole-CV review fluently and wrongly rather than
              failing. Typing a recognised frontier model id pre-ticks this
              (looksHighEnd), but the user always has the last word. */}
          <label className="check-row sm-highend">
            <input type="checkbox" checked={llmHighEnd}
              onChange={(e) => setLlmHighEnd(e.target.checked)} />
            <span>
              <Gauge size={13} /> This is a high-end model
            </span>
          </label>
          <p className="sm-help">
            Unlocks the <strong>advanced assists</strong>: whole-CV review, the
            consistency &amp; voice pass, achievement mining, cross-language
            meaning checks, and profile positioning. These ask the model to judge
            your entire CV at once — leave this off for small local models
            (roughly under 30B), which answer confidently and wrongly rather than
            admitting they can't.
          </p>

          <style>{`
            .sm-highend { margin-top: 4px; }
            .sm-highend span { display: inline-flex; align-items: center; gap: 6px; }
            .sm-highend svg { color: var(--secondary-ink); }
          `}</style>
        </div>
      )}

      {llmProvider === 'ollama_docker' && (
        <div className="sm-sub">
          <p className="sm-help">
            Runs Ollama in Docker at <code>http://localhost:11434</code>.
            Requires Docker Desktop; “Start” pulls the model above (several
            GB on first run).
          </p>
          <div className="sm-btn-row">
            <button className="sm-btn" onClick={() => void onOllamaDocker('start')} disabled={llmDocker.busy}>
              {llmDocker.busy ? <Loader2 size={13} className="sm-spin" /> : <Power size={13} />} Start &amp; pull
            </button>
            <button className="sm-btn" onClick={() => void onOllamaDocker('stop')} disabled={llmDocker.busy}>
              <Box size={13} /> Stop
            </button>
            <button className="sm-btn" onClick={() => void onOllamaDocker('status')} disabled={llmDocker.busy}>
              <Server size={13} /> Check status
            </button>
          </div>
          {llmDocker.text && (
            <div className={`sm-inline ${llmDocker.ok ? 'sm-ok' : 'sm-warn'}`}>
              {llmDocker.ok ? <Check size={13} /> : <AlertCircle size={13} />} {llmDocker.text}
            </div>
          )}
          <p className="sm-help">Click <strong>Save</strong> to enable the Summarize button on every launch.</p>
        </div>
      )}

      {llmProvider === 'ollama_remote' && (
        <div className="sm-sub">
          <input className="sm-input" placeholder="http://your-ollama-host:11434"
            value={llmOllamaUrl} onChange={(e) => setLlmOllamaUrl(e.target.value)} aria-label="Ollama URL" />
        </div>
      )}

      {llmProvider === 'openai' && (
        <div className="sm-sub">
          <input className="sm-input" type="password" placeholder={keyPlaceholder(llmKeySet.openai)}
            value={llmKeys.openai} onChange={(e) => setLlmKeys((k) => ({ ...k, openai: e.target.value }))}
            aria-label="OpenAI API key" />
          <p className="sm-help">Get a key at <code>platform.openai.com</code>.</p>
        </div>
      )}

      {llmProvider === 'anthropic' && (
        <div className="sm-sub">
          <input className="sm-input" type="password" placeholder={keyPlaceholder(llmKeySet.anthropic)}
            value={llmKeys.anthropic} onChange={(e) => setLlmKeys((k) => ({ ...k, anthropic: e.target.value }))}
            aria-label="Anthropic API key" />
          <p className="sm-help">Native Claude Messages API. Get a key at <code>console.anthropic.com</code>.</p>
        </div>
      )}

      {llmProvider === 'gemini' && (
        <div className="sm-sub">
          <input className="sm-input" type="password" placeholder={keyPlaceholder(llmKeySet.gemini)}
            value={llmKeys.gemini} onChange={(e) => setLlmKeys((k) => ({ ...k, gemini: e.target.value }))}
            aria-label="Google Gemini API key" />
          <p className="sm-help">Uses Google's OpenAI-compatible endpoint. Get a key at <code>aistudio.google.com</code>.</p>
        </div>
      )}

      {llmProvider === 'mistral' && (
        <div className="sm-sub">
          <input className="sm-input" type="password" placeholder={keyPlaceholder(llmKeySet.mistral)}
            value={llmKeys.mistral} onChange={(e) => setLlmKeys((k) => ({ ...k, mistral: e.target.value }))}
            aria-label="Mistral API key" />
          <p className="sm-help">Get a key at <code>console.mistral.ai</code>.</p>
        </div>
      )}

      {llmProvider === 'compat' && (
        <div className="sm-sub">
          <input className="sm-input" placeholder="Base URL, e.g. https://openrouter.ai/api/v1"
            value={llmCompatUrl} onChange={(e) => setLlmCompatUrl(e.target.value)} aria-label="OpenAI-compatible base URL" />
          <input className="sm-input" type="password" placeholder={keyPlaceholder(llmKeySet.compat)}
            value={llmKeys.compat} onChange={(e) => setLlmKeys((k) => ({ ...k, compat: e.target.value }))}
            aria-label="OpenAI-compatible API key" />
        </div>
      )}

      {llmProvider !== 'off' && (
        <div className="sm-btn-row">
          {/* Saves first — see onTestLlm in SettingsModal. */}
          <button className="sm-btn" onClick={() => void onTestLlm()} disabled={llmTest.busy}>
            {llmTest.busy ? <Loader2 size={13} className="sm-spin" /> : <Server size={13} />} Save and test
          </button>
          {llmTest.text && (
            <span className={`sm-inline ${llmTest.ok ? 'sm-ok' : 'sm-warn'}`}>
              {llmTest.ok ? <Check size={13} /> : <AlertCircle size={13} />} {llmTest.text}
            </span>
          )}
        </div>
      )}
    </section>
  )
}
