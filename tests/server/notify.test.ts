import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import {
  buildNotifyCommand, buildConfirmPowerShellScript, buildConfirmAppleScript,
  buildConfirmZenityArgs, notify, confirmInstall,
} from '../../server/desktop/notify'

class FakeChild extends EventEmitter {
  unrefCalls = 0
  unref(): void { this.unrefCalls += 1 }
}

const shell = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: readonly string[]; opts: Record<string, unknown> | undefined }[],
  children: [] as FakeChild[],
  throwOnSpawn: null as Error | null,
}))

vi.mock('child_process', () => ({
  spawn: (cmd: string, args: readonly string[], opts?: Record<string, unknown>) => {
    shell.calls.push({ cmd, args, opts })
    if (shell.throwOnSpawn) throw shell.throwOnSpawn
    const child = new FakeChild()
    shell.children.push(child)
    return child
  },
}))

const PLATFORM = Object.getOwnPropertyDescriptor(process, 'platform')!
function stubPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

beforeEach(() => {
  shell.calls.length = 0
  shell.children.length = 0
  shell.throwOnSpawn = null
})

afterEach(() => { Object.defineProperty(process, 'platform', PLATFORM) })

describe('buildNotifyCommand', () => {
  it('Windows → PowerShell MessageBox with single-quote escaping', () => {
    const c = buildNotifyCommand('Resume Studio', "It's current", 'win32')
    expect(c.cmd).toBe('powershell')
    const script = c.args[c.args.length - 1]
    expect(script).toContain('System.Windows.Forms.MessageBox')
    // '' escapes the apostrophe
    expect(script).toContain("'It''s current'")
    expect(script).toContain("'Resume Studio'")
    // no unescaped double quotes that Node's arg quoting would mangle
    expect(script).not.toContain('"')
  })

  it('macOS → osascript display dialog with double-quote escaping', () => {
    const c = buildNotifyCommand('Resume Studio', 'say "hi"\\done', 'darwin')
    expect(c.cmd).toBe('osascript')
    expect(c.args[0]).toBe('-e')
    expect(c.args[1]).toContain('display dialog')
    // Escaped quotes
    expect(c.args[1]).toContain('\\"hi\\"')
    // Escaped backslash
    expect(c.args[1]).toContain('\\\\done')
  })

  it('Linux → notify-send with title + message as direct args (no shell)', () => {
    const c = buildNotifyCommand('Resume Studio', 'up to date', 'linux')
    expect(c).toEqual({ cmd: 'notify-send', args: ['Resume Studio', 'up to date'] })
  })
})

describe('notify()', () => {
  it('spawns the platform command detached with ignored stdio, and unrefs it', () => {
    const expected = buildNotifyCommand('Resume Studio', 'Up to date')
    notify('Resume Studio', 'Up to date')
    expect(shell.calls).toHaveLength(1)
    expect(shell.calls[0]).toEqual({
      cmd: expected.cmd,
      args: expected.args,
      opts: { detached: true, stdio: 'ignore', windowsHide: true },
    })
    expect(shell.children[0].unrefCalls).toBe(1)
  })

  it('reports a missing helper through onError without throwing', () => {
    const errors: string[] = []
    notify('T', 'M', (m) => errors.push(m))
    shell.children[0].emit('error', new Error('ENOENT'))
    expect(errors).toEqual(['notify unavailable: ENOENT'])
  })

  it('a helper error with no onError is swallowed', () => {
    notify('T', 'M')
    expect(() => shell.children[0].emit('error', new Error('ENOENT'))).not.toThrow()
  })

  it('a spawn throw becomes an onError note, never an exception', () => {
    shell.throwOnSpawn = new Error('EPERM')
    const errors: string[] = []
    expect(() => notify('T', 'M', (m) => errors.push(m))).not.toThrow()
    expect(errors).toEqual(['notify failed: EPERM'])
  })

  it('a spawn throw with no onError still does not throw', () => {
    shell.throwOnSpawn = new Error('EPERM')
    expect(() => notify('T', 'M')).not.toThrow()
  })
})

describe('confirm dialog builders (Install / Cancel)', () => {
  it('Windows → WinForms script with Install + Cancel buttons, exits 0/1', () => {
    const s = buildConfirmPowerShellScript('Cartavio Resume Studio', "It's here")
    expect(s).toContain('System.Windows.Forms.Form')
    expect(s).toContain("$ok.Text = 'Install'")
    expect(s).toContain("$cancel.Text = 'Cancel'")
    expect(s).toContain('exit 0')
    expect(s).toContain('exit 1')
    // Single-quote escaped
    expect(s).toContain("'It''s here'")
  })

  it('macOS → osascript dialog with Cancel/Install buttons, Install default', () => {
    const s = buildConfirmAppleScript('Cartavio Resume Studio', 'new "build"')
    expect(s).toContain('display dialog')
    expect(s).toContain('buttons {"Cancel", "Install"}')
    expect(s).toContain('default button "Install"')
    // Escaped quotes
    expect(s).toContain('\\"build\\"')
  })

  it('Linux → zenity question with Install/Cancel labels', () => {
    const a = buildConfirmZenityArgs('Cartavio Resume Studio', 'New version 1.2.3 available')
    expect(a).toContain('--question')
    expect(a).toContain('--ok-label=Install')
    expect(a).toContain('--cancel-label=Cancel')
    expect(a).toContain('--title=Cartavio Resume Studio')
    expect(a).toContain('--text=New version 1.2.3 available')
  })
})

describe('confirmInstall()', () => {
  it('win32: writes the WinForms script to a temp .ps1, runs it via -File, Install → true + cleanup', async () => {
    stubPlatform('win32')
    const p = confirmInstall('Cartavio Resume Studio', "It's ready")
    expect(shell.calls).toHaveLength(1)
    const { cmd, args, opts } = shell.calls[0]
    expect(cmd).toBe('powershell.exe')
    expect(args.slice(0, 4)).toEqual(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'])
    const tmp = args[4]
    expect(tmp).toMatch(/rs-confirm-.*\.ps1$/)
    expect(fs.readFileSync(tmp, 'utf8')).toBe(buildConfirmPowerShellScript('Cartavio Resume Studio', "It's ready"))
    expect(opts).toEqual({ windowsHide: true })
    shell.children[0].emit('close', 0)
    await expect(p).resolves.toBe(true)
    expect(fs.existsSync(tmp)).toBe(false)
  })

  it('win32: Cancel (exit 1) → false, and the temp script is still removed', async () => {
    stubPlatform('win32')
    const p = confirmInstall('T', 'M')
    const tmp = shell.calls[0].args[4]
    shell.children[0].emit('close', 1)
    await expect(p).resolves.toBe(false)
    expect(fs.existsSync(tmp)).toBe(false)
  })

  it('win32: a missing PowerShell resolves false, with or without onError', async () => {
    stubPlatform('win32')
    const errors: string[] = []
    const p1 = confirmInstall('T', 'M', (m) => errors.push(m))
    shell.children[0].emit('error', new Error('gone'))
    await expect(p1).resolves.toBe(false)
    expect(errors).toEqual(['confirm unavailable: gone'])

    const p2 = confirmInstall('T', 'M')
    expect(() => shell.children[1].emit('error', new Error('gone'))).not.toThrow()
    await expect(p2).resolves.toBe(false)

    // The error path never reaches the close handler's cleanup.
    for (const c of shell.calls) fs.rmSync(c.args[4], { force: true })
  })

  it('darwin: runs the AppleScript dialog; Install (0) → true, Cancel (1) → false', async () => {
    stubPlatform('darwin')
    const p1 = confirmInstall('T', 'new "build"')
    expect(shell.calls[0].cmd).toBe('osascript')
    expect(shell.calls[0].args).toEqual(['-e', buildConfirmAppleScript('T', 'new "build"')])
    shell.children[0].emit('close', 0)
    await expect(p1).resolves.toBe(true)

    const p2 = confirmInstall('T', 'M')
    shell.children[1].emit('close', 1)
    await expect(p2).resolves.toBe(false)
  })

  it('darwin: a missing osascript resolves false, with or without onError', async () => {
    stubPlatform('darwin')
    const errors: string[] = []
    const p1 = confirmInstall('T', 'M', (m) => errors.push(m))
    shell.children[0].emit('error', new Error('gone'))
    await expect(p1).resolves.toBe(false)
    expect(errors).toEqual(['confirm unavailable: gone'])

    const p2 = confirmInstall('T', 'M')
    expect(() => shell.children[1].emit('error', new Error('gone'))).not.toThrow()
    await expect(p2).resolves.toBe(false)
  })

  it('linux: runs the zenity question; Install (0) → true, Cancel (1) → false', async () => {
    stubPlatform('linux')
    const p1 = confirmInstall('T', 'New version available')
    expect(shell.calls[0].cmd).toBe('zenity')
    expect(shell.calls[0].args).toEqual(buildConfirmZenityArgs('T', 'New version available'))
    shell.children[0].emit('close', 0)
    await expect(p1).resolves.toBe(true)

    const p2 = confirmInstall('T', 'M')
    shell.children[1].emit('close', 1)
    await expect(p2).resolves.toBe(false)
  })

  it('linux: a missing zenity resolves false, with or without onError', async () => {
    stubPlatform('linux')
    const errors: string[] = []
    const p1 = confirmInstall('T', 'M', (m) => errors.push(m))
    shell.children[0].emit('error', new Error('gone'))
    await expect(p1).resolves.toBe(false)
    expect(errors).toEqual(['confirm unavailable: gone'])

    const p2 = confirmInstall('T', 'M')
    expect(() => shell.children[1].emit('error', new Error('gone'))).not.toThrow()
    await expect(p2).resolves.toBe(false)
  })

  it('a spawn throw resolves false and notes it, with or without onError', async () => {
    stubPlatform('linux')
    shell.throwOnSpawn = new Error('EACCES')
    const errors: string[] = []
    await expect(confirmInstall('T', 'M', (m) => errors.push(m))).resolves.toBe(false)
    expect(errors).toEqual(['confirm failed: EACCES'])
    await expect(confirmInstall('T', 'M')).resolves.toBe(false)
  })
})
