/**
 * Local address — the name this computer reaches the app at, instead of
 * `http://127.0.0.1:1923`.
 *
 * Two names are offered because they cost different amounts. A `.localhost`
 * name works everywhere with nothing installed; a `.local` name needs one
 * elevated write to the system hosts file but is then resolved by everything,
 * not just browsers. The choice is the user's, and the panel says plainly what
 * each one will do before it does it — an app that edits a system file should
 * never be vague about it.
 */

import { useCallback, useEffect, useState } from 'react'
import { Globe, ShieldCheck, Loader2, Trash2 } from 'lucide-react'
import { api, type HostnameStatus } from '../../lib/api'
import { useSettingsForm } from './context'

/** The two suggestions, and what picking each one commits the user to. */
const SUGGESTIONS = [
  {
    hostname: 'resumestudio.localhost',
    label: 'resumestudio.localhost',
    detail: 'Works immediately in any browser — nothing to install.',
  },
  {
    hostname: 'resumestudio.local',
    label: 'resumestudio.local',
    detail: 'Needs one approval to add a line to your system hosts file. Then it works everywhere, not just in browsers.',
  },
]

/**
 * Mirrors the server's rule (server/localHost.ts) closely enough to enable or
 * disable a button. The SERVER is authoritative — this only exists so a typo in
 * the custom field is visible before Save rather than as a 400 after it.
 */
function looksValid(name: string): boolean {
  const h = name.trim().toLowerCase()
  if (!h || h.length > 253) return false
  if (!(h.endsWith('.local') || h.endsWith('.localhost'))) return false
  return h.split('.').every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l))
}

export function AddressTab() {
  const { managed, localHostname, setLocalHostname, localPort, setLocalPort } = useSettingsForm()
  const [status, setStatus] = useState<HostnameStatus | null>(null)
  const [busy, setBusy] = useState<null | 'install' | 'uninstall'>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const name = localHostname.trim()
  const valid = looksValid(name)

  const refresh = useCallback(async (h: string) => {
    setStatus(h && looksValid(h) ? await api.hostnameStatus(h) : null)
  }, [])

  useEffect(() => { void refresh(name) }, [name, refresh])

  const act = useCallback(async (action: 'install' | 'uninstall') => {
    setBusy(action); setResult(null)
    const r = await api.hostnameSetup(action, name)
    setBusy(null)
    if (!r) { setResult({ ok: false, text: 'The request failed.' }); return }
    setResult({ ok: r.ok, text: r.message })
    setStatus(r.status)
  }, [name])

  if (!managed) {
    return (
      <section className="sm-sec">
        <div className="sm-sec-head"><Globe size={15} /> Local address</div>
        <p className="sm-help">
          This deployment is reached at whatever address the server is published
          on, so there is nothing to configure here.
        </p>
      </section>
    )
  }

  return (
    <>
      <section className="sm-sec">
        <div className="sm-sec-head"><Globe size={15} /> Local address</div>
        <p className="sm-help">
          Give this computer a name for Resume Studio so you can bookmark
          something readable instead of an IP address. The app still listens only
          on this machine — a name changes what you type, not who can reach it.
        </p>

        <div className="ad-picks">
          <label className="ad-pick">
            <input
              type="radio" name="ad-name" checked={!name}
              onChange={() => setLocalHostname('')}
            />
            <strong>Use the IP address</strong>
            <em>http://127.0.0.1 — no name, nothing to set up.</em>
          </label>
          {SUGGESTIONS.map((s) => (
            <label className="ad-pick" key={s.hostname}>
              <input
                type="radio" name="ad-name" checked={name === s.hostname}
                onChange={() => setLocalHostname(s.hostname)}
              />
              <strong>{s.label}</strong>
              <em>{s.detail}</em>
            </label>
          ))}
        </div>

        <label className="sm-field-label" htmlFor="ad-custom">Or another name (must end in .local or .localhost)</label>
        <input
          id="ad-custom" className="sm-input" value={localHostname}
          placeholder="e.g. cv.localhost"
          onChange={(e) => setLocalHostname(e.target.value)}
        />
        {name && !valid && (
          <p className="sm-help sm-warn">A local name has to end in <code>.local</code> or <code>.localhost</code>.</p>
        )}

        {status && (
          <div className="ad-status">
            {status.automatic ? (
              <p className="sm-help">
                <ShieldCheck size={13} className="ad-ico" /> <strong>{status.hostname}</strong> needs no
                setup — every browser sends <code>.localhost</code> names straight to this computer.
              </p>
            ) : status.installed ? (
              <p className="sm-help">
                <ShieldCheck size={13} className="ad-ico" /> <strong>{status.hostname}</strong> is in
                your hosts file and points at this computer.
              </p>
            ) : (
              <p className="sm-help">
                <strong>{status.hostname}</strong> is not set up yet. Setting it up adds one line to{' '}
                <code>{status.file}</code>
                {status.writable ? '.' : ', which needs your approval in the system administrator prompt.'}
              </p>
            )}
            {status.note && <p className="sm-help sm-warn">{status.note}</p>}

            {!status.automatic && (
              <div className="sm-btn-row">
                {!status.installed && (
                  <button type="button" className="sm-btn" disabled={busy !== null || !valid}
                    onClick={() => void act('install')}>
                    {busy === 'install' ? <Loader2 size={13} className="sm-spin" /> : <ShieldCheck size={13} />}
                    {' '}Set up {status.hostname}
                  </button>
                )}
                {status.managed && (
                  <button type="button" className="sm-btn" disabled={busy !== null}
                    onClick={() => void act('uninstall')}>
                    {busy === 'uninstall' ? <Loader2 size={13} className="sm-spin" /> : <Trash2 size={13} />}
                    {' '}Remove the entry
                  </button>
                )}
              </div>
            )}

            {result && (
              <p className={`sm-help ${result.ok ? 'sm-ok' : 'sm-warn'}`} role="status">{result.text}</p>
            )}
            {!status.automatic && !status.installed && (
              <p className="sm-help">
                Prefer to do it yourself? Run:<br /><code>{status.manualCommand}</code>
              </p>
            )}
          </div>
        )}
      </section>

      <section className="sm-sec">
        <div className="sm-sec-head"><Globe size={15} /> Port</div>
        <p className="sm-help">
          Resume Studio takes port <strong>80</strong> when it is free, so the
          address needs no <code>:port</code> suffix at all, and falls back to{' '}
          <strong>1923</strong> when something else already has it (IIS, another
          local server). Pin a port here if you need a specific one.
        </p>
        <label className="check-row">
          <input
            type="checkbox" checked={localPort === 0}
            onChange={(e) => setLocalPort(e.target.checked ? 0 : 1923)}
          />
          Choose automatically (80, then 1923)
        </label>
        {localPort !== 0 && (
          <>
            <label className="sm-field-label" htmlFor="ad-port">Fixed port</label>
            <input
              id="ad-port" className="sm-input" type="number" min={1} max={65535}
              value={localPort}
              onChange={(e) => setLocalPort(Math.min(65535, Math.max(1, Number(e.target.value) || 1)))}
            />
          </>
        )}
        <p className="sm-help">
          The port is chosen when the app starts, so a change here takes effect
          the next time you launch it.
        </p>
      </section>

      <style>{`
        .ad-picks { display: flex; flex-direction: column; gap: 6px; margin: 10px 0 14px; }
        /* Grid, not flex: the detail line has to sit under the label text, not
           under the radio, and the radio must stay top-aligned to both. */
        .ad-pick {
          display: grid; grid-template-columns: auto 1fr; gap: 2px 9px;
          font-size: 13px; cursor: pointer; align-items: start;
        }
        .ad-pick input { accent-color: var(--accent); margin-top: 3px; }
        .ad-pick em {
          grid-column: 2; font-style: normal; font-size: 12.5px;
          color: var(--ink-faint); line-height: 1.45;
        }
        .ad-status {
          margin-top: 12px; padding: 10px 12px;
          background: var(--paper-sunken); border: 1px solid var(--line);
          border-radius: var(--r-sm);
        }
        .ad-status .sm-help:last-child { margin-bottom: 0; }
        .ad-ico { vertical-align: -2px; color: var(--ok-ink); }
      `}</style>
    </>
  )
}
