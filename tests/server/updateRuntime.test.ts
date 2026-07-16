import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  buildSwapScript, initUpdateRuntime, runCheck, getUpdateStatus, __resetUpdateRuntimeForTests,
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
    expect(s.contents).toContain("'#' * $fill") // ascii progress bar
    // Paths embedded as single-quoted PS literals.
    expect(s.contents).toContain(`$dst = '/opt/Resume Studio'`)
  })

  it('relaunches WINDOWLESS via wscript.exe + the no-window .vbs shim', () => {
    // wscript invoked by name (not by file association — the "text editor"
    // bug class), running the .vbs shim that starts node.exe hidden. A
    // tray-initiated update must not leave the app behind a console window.
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
    expect(s.contents).toContain('resume-studio.sh') // linux launcher name
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

    await runCheck(false)            // daily/background → no popup
    expect(notify).not.toHaveBeenCalled()

    await runCheck(true)             // manual tray click → popup
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

  function wireUpdate(confirmInstall: (t: string, m: string) => Promise<boolean>) {
    initUpdateRuntime({
      installDir: '/tmp/rs', appVersion: '0.0.1', log: () => {},
      requestShutdown: () => {}, notify: vi.fn(), confirmInstall,
    })
    const asset = assetNameFor()
    vi.stubGlobal('fetch', (async () => new Response(JSON.stringify({
      tag_name: 'v9.9.9',
      assets: [{ name: asset, browser_download_url: `https://github.com/sveinmagnus/resumestudio/releases/download/v9.9.9/${asset}` }],
    }), { status: 200 })) as unknown as typeof fetch)
  }

  it('prompts "New version X available" and does not install on Cancel', async () => {
    const confirm = vi.fn(async () => false) // user clicks Cancel
    wireUpdate(confirm)
    await runCheck(true)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][1]).toMatch(/new version 9\.9\.9 available/i)
  })

  it('de-dups the daily (background) offer per version, but a manual check always prompts', async () => {
    const confirm = vi.fn(async () => false)
    wireUpdate(confirm)
    await runCheck(false) // background → offers once
    await runCheck(false) // same version again → no re-offer
    expect(confirm).toHaveBeenCalledTimes(1)
    await runCheck(true)  // manual → always offers
    expect(confirm).toHaveBeenCalledTimes(2)
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
