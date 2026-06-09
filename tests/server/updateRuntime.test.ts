import { describe, it, expect } from 'vitest'
import { buildSwapScript } from '../../server/desktop/updateRuntime'

const base = {
  installDir: '/opt/Resume Studio',
  stagedDir: '/opt/Resume Studio/data/updates/2.0.0/extracted',
  stagingVersionDir: '/opt/Resume Studio/data/updates/2.0.0',
  pid: 4321,
}

describe('buildSwapScript (Windows)', () => {
  const s = buildSwapScript({ ...base, platform: 'win32' })

  it('writes a .cmd spawned via cmd.exe /c', () => {
    expect(s.path.endsWith('apply-update.cmd')).toBe(true)
    expect(s.spawn).toEqual({ cmd: 'cmd.exe', args: ['/c', s.path] })
  })

  it('waits for the PID, mirrors with robocopy, relaunches, and self-deletes', () => {
    expect(s.contents).toContain('PID eq 4321')
    expect(s.contents).toContain('ping 127.0.0.1') // redirect-safe sleep, not timeout
    expect(s.contents).toContain('robocopy')
    expect(s.contents).toContain('/MIR')
    expect(s.contents).toContain('Resume Studio.cmd"')
    expect(s.contents).toContain('del "%~f0"')
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
