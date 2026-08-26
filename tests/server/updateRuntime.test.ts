import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  buildSwapScript, initUpdateRuntime, runCheck, runInstall, getUpdateStatus, trayView,
  setTrayRefresher, handleCheckClick, handleInstallClick, __resetUpdateRuntimeForTests,
} from '../../server/desktop/updateRuntime'
import { assetNameFor } from '../../server/desktop/updater'

const base = {
  installDir: '/opt/Resume Studio',
  stagedDir: '/opt/Resume Studio/data/updates/2.0.0/extracted',
  stagingVersionDir: '/opt/Resume Studio/data/updates/2.0.0',
  pid: 4321,
}

describe('buildSwapScript (Windows)', () => {
  const s = buildSwapScript({ ...base, platform: 'win32' })

  it('writes a .ps1 launched in a VISIBLE window via cmd /c start (no association)', () => {
    expect(s.path.endsWith('apply-update.ps1')).toBe(true)
    expect(s.spawn.cmd).toBe('cmd.exe')
    // `start ""` opens a real window; powershell invoked by name (not by file
    // association — that was the "text editor" bug).
    expect(s.spawn.args.slice(0, 4)).toEqual(['/c', 'start', '', 'powershell.exe'])
    expect(s.spawn.args).toContain('-File')
    expect(s.spawn.args[s.spawn.args.length - 1]).toBe(s.path)
  })

  it('waits via Wait-Process (not tasklist|find/ping) and copies with a progress bar', () => {
    expect(s.contents).toContain('Wait-Process -Id 4321')
    expect(s.contents).not.toContain('tasklist')
    expect(s.contents).not.toContain('robocopy')
    expect(s.contents).toContain('Copy-Item')
    // Ascii progress bar
    expect(s.contents).toContain("'#' * $fill")
    // Paths embedded as single-quoted PS literals.
    expect(s.contents).toContain(`$dst = '/opt/Resume Studio'`)
  })

  it('relaunches WINDOWLESS via wscript.exe + the no-window .vbs shim, trying the current name then the legacy one', () => {
    // wscript invoked by name (not by file association — the "text editor"
    // bug class), running the .vbs shim that starts node.exe hidden. A
    // tray-initiated update must not leave the app behind a console window.
    // Both shim names are load-bearing: the current one going forward, the
    // legacy one because builds ≤1.2.0 shipped only that file.
    expect(s.contents).toContain(`Join-Path $dst 'ResumeStudio-Windows.vbs'`)
    expect(s.contents).toContain(`Join-Path $dst 'Resume Studio (no window).vbs'`)
    expect(s.contents).toContain(`Start-Process -FilePath 'wscript.exe' -ArgumentList ('"' + $vbs + '"')`)
  })

  it('falls back to the console .cmd via cmd /c when the .vbs is missing', () => {
    expect(s.contents).toContain('if (Test-Path -LiteralPath $vbs)')
    expect(s.contents).toContain('$env:ComSpec')
    expect(s.contents).toContain('Resume Studio.cmd')
  })
})

describe('buildSwapScript (POSIX)', () => {
  const s = buildSwapScript({ ...base, platform: 'linux' })

  it('writes a .sh spawned via sh', () => {
    expect(s.path.endsWith('apply-update.sh')).toBe(true)
    expect(s.spawn).toEqual({ cmd: 'sh', args: [s.path] })
  })

  it('waits for the PID, copies the build, relaunches, and cleans staging', () => {
    expect(s.contents).toContain('kill -0 4321')
    expect(s.contents).toContain('cp -R')
    // Linux launcher name
    expect(s.contents).toContain('resume-studio.sh')
    expect(s.contents).toContain('nohup')
    expect(s.contents).toContain('rm -rf')
  })

  it('uses the .command launcher on macOS', () => {
    const mac = buildSwapScript({ ...base, platform: 'darwin' })
    expect(mac.contents).toContain('Resume Studio.command')
  })

  it('single-quote-escapes paths to survive spaces', () => {
    // The install dir has a space; it must be single-quoted in the script.
    expect(s.contents).toContain(`'/opt/Resume Studio'`)
  })
})

describe('runCheck → manual-check popup (announce)', () => {
  afterEach(() => { __resetUpdateRuntimeForTests(); vi.unstubAllGlobals() })

  function wire(notify: (t: string, m: string) => void) {
    initUpdateRuntime({
      installDir: '/tmp/rs', appVersion: '0.0.1', log: () => {},
      requestShutdown: () => {}, notify,
    })
    // Same version → up to date.
    vi.stubGlobal('fetch', (async () => new Response(
      JSON.stringify({ tag_name: 'v0.0.1', assets: [] }), { status: 200 },
    )) as unknown as typeof fetch)
  }

  it('pops a result on a manual check but stays silent on a background check', async () => {
    const notify = vi.fn()
    wire(notify)

    // Daily/background → no popup
    await runCheck(false)
    expect(notify).not.toHaveBeenCalled()

    // Manual tray click → popup
    await runCheck(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][1]).toMatch(/latest version/i)
  })

  it('announces an error result when the check fails', async () => {
    const notify = vi.fn()
    initUpdateRuntime({
      installDir: '/tmp/rs', appVersion: '0.0.1', log: () => {},
      requestShutdown: () => {}, notify,
    })
    vi.stubGlobal('fetch', (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch)

    await runCheck(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][1]).toMatch(/could not check/i)
  })
})

describe('runCheck → Install/Cancel offer when an update is found', () => {
  afterEach(() => { __resetUpdateRuntimeForTests(); vi.unstubAllGlobals() })

  /**
   * Wire a release the updater considers installable. `withChecksum: false`
   * models a release that publishes no `.sha256` sidecar — the updater refuses
   * to install those (fail-closed), so no Install offer should be made.
   */
  function wireUpdate(
    confirmInstall: (t: string, m: string) => Promise<boolean>,
    notify = vi.fn(),
    withChecksum = true,
  ) {
    initUpdateRuntime({
      installDir: '/tmp/rs', appVersion: '0.0.1', log: () => {},
      requestShutdown: () => {}, notify, confirmInstall,
    })
    const asset = assetNameFor()
    const url = `https://github.com/sveinmagnus/resumestudio/releases/download/v9.9.9/${asset}`
    const assets = [{ name: asset, browser_download_url: url }]
    if (withChecksum) assets.push({ name: `${asset}.sha256`, browser_download_url: `${url}.sha256` })
    vi.stubGlobal('fetch', (async () => new Response(JSON.stringify({
      tag_name: 'v9.9.9',
      assets,
    }), { status: 200 })) as unknown as typeof fetch)
    return notify
  }

  it('prompts "New version X available" and does not install on Cancel', async () => {
    // User clicks Cancel
    const confirm = vi.fn(async (_title: string, _message: string) => false)
    wireUpdate(confirm)
    await runCheck(true)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][1]).toMatch(/new version 9\.9\.9 available/i)
  })

  it('de-dups the daily (background) offer per version, but a manual check always prompts', async () => {
    const confirm = vi.fn(async (_title: string, _message: string) => false)
    wireUpdate(confirm)
    // Background → offers once
    await runCheck(false)
    // Same version again → no re-offer
    await runCheck(false)
    expect(confirm).toHaveBeenCalledTimes(1)
    // Manual → always offers
    await runCheck(true)
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('does not offer to install a release that publishes no checksum', async () => {
    // Fail-closed: an unverifiable release must never render an Install prompt
    // (stageUpdate would refuse it anyway). The user is told to fetch it by hand.
    const confirm = vi.fn(async () => true)
    const notify = wireUpdate(confirm, vi.fn(), false)
    await runCheck(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(notify.mock.calls[0][1]).toMatch(/no published checksum/i)
    expect(getUpdateStatus().downloadable).toBe(false)
  })
})

// ─── Reported version ────────────────────────────────────────────────────────

describe('getUpdateStatus() — currentVersion', () => {
  afterEach(() => { __resetUpdateRuntimeForTests?.(); vi.unstubAllEnvs() })

  it('reports the app version even when the updater is unconfigured', () => {
    // Regression: this used to fall back to a literal '0.0.0' whenever the
    // updater runtime was not initialised (dev, `npm run desktop`, VPS), so the
    // Settings → Version tab claimed v0.0.0 while the app knew its real
    // version. It must fall back to APP_VERSION instead.
    vi.stubEnv('RESUME_APP_VERSION', '')
    expect(getUpdateStatus().currentVersion).not.toBe('0.0.0')
    expect(getUpdateStatus().currentVersion).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('prefers an explicit RESUME_APP_VERSION (the published build stamps it)', () => {
    vi.stubEnv('RESUME_APP_VERSION', '9.9.9')
    expect(getUpdateStatus().currentVersion).toBe('9.9.9')
  })
})

/*
 * The tray view and the click handlers — the user's ONLY window into the
 * updater, and until now the largest untested block in the module (35 unreached
 * mutants in trayView alone). Everything below drives the real state machine
 * through the public surface: a wired runtime, a stubbed GitHub answer, and the
 * tray refresher as the observer.
 */
describe('trayView — every state the user can see', () => {
  afterEach(() => { __resetUpdateRuntimeForTests(); vi.unstubAllGlobals() })

  const wireRelease = (over: { withChecksum?: boolean; tag?: string } = {}) => {
    const decline = () => Promise.resolve(false)
    initUpdateRuntime({
      installDir: '/tmp/rs', appVersion: '0.0.1', log: () => {},
      requestShutdown: () => {}, confirmInstall: decline,
    })
    const asset = assetNameFor()
    const tag = over.tag ?? 'v9.9.9'
    const url = `https://github.com/sveinmagnus/resumestudio/releases/download/${tag}/${asset}`
    const assets = [{ name: asset, browser_download_url: url }]
    if (over.withChecksum !== false) {
      assets.push({ name: `${asset}.sha256`, browser_download_url: `${url}.sha256` })
    }
    vi.stubGlobal('fetch', (async () => new Response(
      JSON.stringify({ tag_name: tag, assets }), { status: 200 },
    )) as unknown as typeof fetch)
  }

  it('offers both items at rest: Check enabled, Install disabled', () => {
    initUpdateRuntime({ installDir: '/tmp/rs', appVersion: '0.0.1', log: () => {}, requestShutdown: () => {} })
    expect(trayView()).toMatchObject({
      checkTitle: 'Check for updates', checkEnabled: true,
      installTitle: 'Install update', installEnabled: false,
    })
  })

  it('enables Install, NAMING the version, once an installable update is found', async () => {
    wireRelease()
    await runCheck(false)
    expect(trayView()).toMatchObject({
      installTitle: 'Install update (v9.9.9)', installEnabled: true, checkEnabled: true,
    })
  })

  it('keeps Install DISABLED for a release with no checksum, and says why', async () => {
    // Fail-closed: newer version, nothing to verify it against. The title
    // points at the manual path rather than pretending no update exists.
    wireRelease({ withChecksum: false })
    await runCheck(false)
    expect(trayView()).toMatchObject({ installEnabled: false })
    expect(trayView().installTitle).toMatch(/download manually/)
  })

  it('disables Check while a check is in flight, and re-enables after', async () => {
    // The refresher observes every transition, so the mid-flight view is
    // captured without racing the check.
    wireRelease()
    const seen: string[] = []
    setTrayRefresher((v) => { seen.push(`${v.checkTitle}|${v.checkEnabled}`) })
    await runCheck(false)
    expect(seen).toContain('Checking for updates…|false')
    expect(trayView().checkEnabled).toBe(true)
  })

  it('pushes the CURRENT view the moment a refresher registers', () => {
    initUpdateRuntime({ installDir: '/tmp/rs', appVersion: '0.0.1', log: () => {}, requestShutdown: () => {} })
    const fn = vi.fn()
    setTrayRefresher(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0][0].versionLabel).toMatch(/^Cartavio Resume Studio /)
  })

  it('stops pushing once unregistered', async () => {
    wireRelease()
    const fn = vi.fn()
    setTrayRefresher(fn)
    setTrayRefresher(null)
    const before = fn.mock.calls.length
    await runCheck(false)
    expect(fn.mock.calls.length).toBe(before)
  })
})

describe('the click handlers', () => {
  afterEach(() => { __resetUpdateRuntimeForTests(); vi.unstubAllGlobals() })

  it('Install is a no-op with nothing staged or available', () => {
    const requestShutdown = vi.fn()
    initUpdateRuntime({ installDir: '/tmp/rs', appVersion: '0.0.1', log: () => {}, requestShutdown })
    handleInstallClick()
    expect(requestShutdown).not.toHaveBeenCalled()
    expect(getUpdateStatus().state).toBe('idle')
  })

  it('Check runs a MANUAL check — the result pops even when up to date', async () => {
    const notify = vi.fn()
    initUpdateRuntime({
      installDir: '/tmp/rs', appVersion: '0.0.1', log: () => {}, requestShutdown: () => {}, notify,
    })
    vi.stubGlobal('fetch', (async () => new Response(
      JSON.stringify({ tag_name: 'v0.0.1', assets: [] }), { status: 200 },
    )) as unknown as typeof fetch)
    handleCheckClick()
    await vi.waitFor(() => expect(notify).toHaveBeenCalled())
    expect(getUpdateStatus().state).toBe('uptodate')
  })
})

describe('runInstall — the checksum rejection, end to end', () => {
  afterEach(() => { __resetUpdateRuntimeForTests(); vi.unstubAllGlobals() })

  it('rejects a download whose checksum does not verify, and installs NOTHING', async () => {
    /*
     * The universal fetch stub answers every URL with the release JSON — so the
     * archive downloads "successfully" and then fails verification, which is
     * exactly what a tampered or corrupted asset looks like. The promise under
     * test: the failure is loud, names the checksum, and the state machine
     * lands in `error` without ever reaching the swap script (nothing spawned,
     * no shutdown requested).
     */
    const requestShutdown = vi.fn()
    initUpdateRuntime({
      installDir: '/tmp/rs', appVersion: '0.0.1', log: () => {},
      requestShutdown, confirmInstall: () => Promise.resolve(false),
    })
    const asset = assetNameFor()
    const url = `https://github.com/sveinmagnus/resumestudio/releases/download/v9.9.9/${asset}`
    vi.stubGlobal('fetch', (async () => new Response(JSON.stringify({
      tag_name: 'v9.9.9',
      assets: [
        { name: asset, browser_download_url: url },
        { name: `${asset}.sha256`, browser_download_url: `${url}.sha256` },
      ],
    }), { status: 200 })) as unknown as typeof fetch)

    await runCheck(false)
    expect(getUpdateStatus()).toMatchObject({ state: 'available', downloadable: true, latestVersion: '9.9.9' })

    await runInstall()
    const status = getUpdateStatus()
    expect(status.state).toBe('error')
    expect(status.error).toMatch(/checksum|failed/i)
    expect(requestShutdown).not.toHaveBeenCalled()
    // And the tray reflects it: back to a plain disabled Install.
    expect(trayView().installEnabled).toBe(false)
  })
})
