/**
 * Translation settings — which backend powers the "Draft translation" button.
 *
 * On an env-managed (VPS) build the whole thing is server-controlled, so this
 * shows the resolved status instead of the form.
 */

import { Loader2, Check, AlertCircle, Languages, Server, Box, Power } from 'lucide-react'
import { LOCALE_CODES, LOCALE_LABELS } from '../../lib/locales'
import { useSettingsForm, type UiProvider } from './context'

export function TranslationTab() {
  const {
    status, managed, keyPlaceholder,
    provider, setProvider, libreUrl, setLibreUrl, azureRegion, setAzureRegion,
    keys, setKeys, keySet, docker, onDocker, test, onTest,
    transLangs, setTransLangs, forcedLangs, summProvider,
  } = useSettingsForm()

  if (!managed) {
    return (
      <section className="sm-sec">
        <div className="sm-sec-head"><Languages size={15} /> Translation (Draft button)</div>
        <div className="sm-note">
          On this deployment, settings are controlled by the server's environment
          variables, not from the app.
        </div>
        <div className="sm-row">
          <span>Translation</span>
          <span className={status?.translate.configured ? 'sm-pill sm-pill-ok' : 'sm-pill'}>
            {status?.translate.configured ? 'Configured' : 'Off'}
          </span>
        </div>
      </section>
    )
  }

  return (
    <section className="sm-sec">
      <div className="sm-sec-head"><Languages size={15} /> Translation (Draft button)</div>
      <p className="sm-help">
        The “Draft translation” button needs a translation service.
        “Copy from primary” always works without one.
      </p>

      <label className="sm-field-label" htmlFor="sm-provider">Provider</label>
      <select
        id="sm-provider" className="sm-input" value={provider}
        onChange={(e) => setProvider(e.target.value as UiProvider)} aria-label="Translation provider"
      >
        <option value="off">Off — no machine translation</option>
        <option value="llm">Use the AI model from Summarize (AI assist tab)</option>
        <option value="libre_docker">LibreTranslate — local (Docker-managed)</option>
        <option value="libre_remote">LibreTranslate — remote URL</option>
        <option value="deepl">DeepL</option>
        <option value="google">Google Cloud Translation</option>
        <option value="azure">Microsoft Azure Translator</option>
      </select>

      {provider === 'llm' && (
        <div className="sm-sub">
          <p className="sm-help">
            Translates with whatever model the <strong>AI assist</strong> tab is set
            to — no second engine to install or key to manage.
            {summProvider === 'off'
              ? ' Set a Summarize provider there first, or this stays off.'
              : ' Quality depends on the model: a small local one is rougher than DeepL, so review every draft.'}
          </p>
          {summProvider === 'off' && (
            <div className="sm-inline sm-warn">
              <AlertCircle size={13} /> No AI model configured — pick one on the “AI assist” tab.
            </div>
          )}
        </div>
      )}

      {provider === 'libre_docker' && (
        <div className="sm-sub">
          <p className="sm-help">
            Runs LibreTranslate in Docker at <code>http://localhost:5000</code>.
            Requires Docker Desktop; the first start downloads language
            models (several minutes).
          </p>
          <div className="sm-btn-row">
            <button className="sm-btn" onClick={() => void onDocker('start')} disabled={docker.busy}>
              {docker.busy ? <Loader2 size={13} className="sm-spin" /> : <Power size={13} />} Start
            </button>
            <button className="sm-btn" onClick={() => void onDocker('stop')} disabled={docker.busy}>
              <Box size={13} /> Stop
            </button>
            <button className="sm-btn" onClick={() => void onDocker('status')} disabled={docker.busy}>
              <Server size={13} /> Check status
            </button>
          </div>
          {docker.text && (
            <div className={`sm-inline ${docker.ok ? 'sm-ok' : 'sm-warn'}`}>
              {docker.ok ? <Check size={13} /> : <AlertCircle size={13} />} {docker.text}
            </div>
          )}

          <label className="sm-field-label" id="sm-langs-label">Languages to install</label>
          <p className="sm-help">
            Each language is a separate download (a few hundred MB), so only
            the ones you pick are installed. Your current editing languages
            are always included. Changing this needs a <strong>Stop</strong> →{' '}
            <strong>Start</strong> to take effect.
          </p>
          <div className="sm-lang-grid" role="group" aria-labelledby="sm-langs-label">
            {LOCALE_CODES.map((code) => {
              const forced = forcedLangs.includes(code)
              const name = LOCALE_LABELS[code]?.name ?? code
              return (
                <label key={code} className={`sm-lang ${forced ? 'is-forced' : ''}`}>
                  <input
                    type="checkbox"
                    checked={forced || transLangs.includes(code)}
                    disabled={forced}
                    onChange={(e) => setTransLangs((prev) => (
                      e.target.checked ? [...prev, code] : prev.filter((c) => c !== code)
                    ))}
                    aria-label={forced
                      ? `${name} — always installed (in use / pivot language)`
                      : name}
                  />
                  <span>{LOCALE_LABELS[code]?.flag} {name}</span>
                </label>
              )
            })}
          </div>

          <p className="sm-help">Click <strong>Save</strong> to enable Docker translation on every launch.</p>
        </div>
      )}

      {provider === 'libre_remote' && (
        <div className="sm-sub">
          <input
            className="sm-input" placeholder="https://libretranslate.example.com"
            value={libreUrl} onChange={(e) => setLibreUrl(e.target.value)} aria-label="LibreTranslate URL"
          />
          <input
            className="sm-input" type="password" placeholder={keyPlaceholder(keySet.libre)}
            value={keys.libre} onChange={(e) => setKeys((k) => ({ ...k, libre: e.target.value }))}
            aria-label="LibreTranslate API key"
          />
        </div>
      )}

      {provider === 'deepl' && (
        <div className="sm-sub">
          <p className="sm-help">A DeepL API key. Free and Pro keys are both supported (auto-detected).</p>
          <input
            className="sm-input" type="password" placeholder={keyPlaceholder(keySet.deepl)}
            value={keys.deepl} onChange={(e) => setKeys((k) => ({ ...k, deepl: e.target.value }))}
            aria-label="DeepL API key"
          />
        </div>
      )}

      {provider === 'google' && (
        <div className="sm-sub">
          <p className="sm-help">A Google Cloud Translation API key (Cloud Translation API enabled).</p>
          <input
            className="sm-input" type="password" placeholder={keyPlaceholder(keySet.google)}
            value={keys.google} onChange={(e) => setKeys((k) => ({ ...k, google: e.target.value }))}
            aria-label="Google API key"
          />
        </div>
      )}

      {provider === 'azure' && (
        <div className="sm-sub">
          <p className="sm-help">An Azure Translator key and its resource region (e.g. <code>westeurope</code>).</p>
          <input
            className="sm-input" type="password" placeholder={keyPlaceholder(keySet.azure)}
            value={keys.azure} onChange={(e) => setKeys((k) => ({ ...k, azure: e.target.value }))}
            aria-label="Azure API key"
          />
          <input
            className="sm-input" placeholder="Region, e.g. westeurope"
            value={azureRegion} onChange={(e) => setAzureRegion(e.target.value)} aria-label="Azure region"
          />
        </div>
      )}

      {provider !== 'off' && provider !== 'libre_docker' && (
        <div className="sm-btn-row">
          {/* Saves first — see onTest in SettingsModal. Anything else risks
              reporting on config the server isn't actually using. */}
          <button className="sm-btn" onClick={() => void onTest()} disabled={test.busy}>
            {test.busy ? <Loader2 size={13} className="sm-spin" /> : <Server size={13} />} Save and test
          </button>
          {test.text && (
            <span className={`sm-inline ${test.ok ? 'sm-ok' : 'sm-warn'}`}>
              {test.ok ? <Check size={13} /> : <AlertCircle size={13} />} {test.text}
            </span>
          )}
        </div>
      )}
    </section>
  )
}
