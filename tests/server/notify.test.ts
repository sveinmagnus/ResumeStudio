import { describe, it, expect } from 'vitest'
import {
  buildNotifyCommand, buildConfirmPowerShellScript, buildConfirmAppleScript,
  buildConfirmZenityArgs,
} from '../../server/desktop/notify'

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
