import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { translateReachable, startTranslate, stopTranslate, dockerAvailable } from '../../server/translateDocker'

/** One scripted child process: what it prints and how it exits. */
interface ScriptedRun {
  code?: number | null
  stdout?: string
  stderr?: string
  /** Emit 'error' instead of 'close' (binary missing at the spawn level). */
  errorMessage?: string
  /** Never emit anything — a hung process, until kill() forces a close. */
  hang?: boolean
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false
  kill(): boolean {
    this.killed = true
    this.emit('close', null)
    return true
  }
}

const shell = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: readonly string[]; opts: Record<string, unknown> }[],
  script: [] as ScriptedRun[],
  children: [] as FakeChild[],
  throwOnSpawn: null as Error | null,
}))

vi.mock('child_process', () => ({
  spawn: (cmd: string, args: readonly string[], opts: Record<string, unknown>) => {
    shell.calls.push({ cmd, args, opts })
    if (shell.throwOnSpawn) throw shell.throwOnSpawn
    const spec = shell.script.shift() ?? {}
    const child = new FakeChild()
    shell.children.push(child)
    if (!spec.hang) {
      // Handlers are attached synchronously inside run()'s executor, so the
      // next microtask is late enough to be observed.
      queueMicrotask(() => {
        if (spec.stdout) child.stdout.emit('data', spec.stdout)
        if (spec.stderr) child.stderr.emit('data', spec.stderr)
        if (spec.errorMessage != null) child.emit('error', new Error(spec.errorMessage))
        else child.emit('close', spec.code ?? 0)
      })
    }
    return child
  },
}))

const dockerOk: ScriptedRun = { code: 0, stdout: '27.4.0\n' }
const COMPOSE = 'C:/app/docker-compose.yml'

beforeEach(() => {
  shell.calls.length = 0
  shell.script.length = 0
  shell.children.length = 0
  shell.throwOnSpawn = null
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); delete process.env.RESUME_COMPOSE_FILE })

describe('dockerAvailable', () => {
  it('asks the docker CLI for the server version, argv-only', async () => {
    shell.script.push(dockerOk)
    expect(await dockerAvailable()).toBe(true)
    expect(shell.calls).toHaveLength(1)
    expect(shell.calls[0].cmd).toBe('docker')
    expect(shell.calls[0].args).toEqual(['version', '--format', '{{.Server.Version}}'])
    expect(shell.calls[0].opts).toEqual({ windowsHide: true })
  })

  it('is false when the CLI exits non-zero (daemon down)', async () => {
    shell.script.push({ code: 1, stdout: '27.4.0\n' })
    expect(await dockerAvailable()).toBe(false)
  })

  it('is false when the version output is only whitespace', async () => {
    shell.script.push({ code: 0, stdout: '  \n' })
    expect(await dockerAvailable()).toBe(false)
  })

  it('is false when the binary is missing (spawn error event)', async () => {
    shell.script.push({ errorMessage: 'spawn docker ENOENT' })
    expect(await dockerAvailable()).toBe(false)
  })

  it('is false when spawn itself throws', async () => {
    shell.throwOnSpawn = new Error('EPERM')
    expect(await dockerAvailable()).toBe(false)
  })

  it('kills a hung docker CLI at the timeout instead of hanging the caller', async () => {
    vi.useFakeTimers()
    try {
      shell.script.push({ hang: true })
      const p = dockerAvailable()
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(p).resolves.toBe(false)
      expect(shell.children[0].killed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('translateReachable', () => {
  it('rejects a non-http(s) URL without hitting the network', async () => {
    const r = await translateReachable('ftp://nope')
    expect(r.reachable).toBe(false)
    expect(r.message).toMatch(/http/i)
  })

  it('requires the scheme at the START of the URL', async () => {
    const fn = vi.fn()
    vi.stubGlobal('fetch', fn)
    const r = await translateReachable('not-a-url http://localhost:5000')
    expect(r.reachable).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('reports reachable + language count when /languages returns an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ code: 'en' }, { code: 'nb' }, { code: 'sv' }],
    }))
    const r = await translateReachable('http://localhost:5000')
    expect(r.reachable).toBe(true)
    expect(r.languages).toBe(3)
    expect(r.message).toBe('Reachable — 3 languages loaded.')
  })

  it('probes /languages on the normalized URL with an abort signal', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fn)
    await translateReachable('  http://localhost:5000//  ')
    expect(fn.mock.calls[0][0]).toBe('http://localhost:5000/languages')
    const opts = fn.mock.calls[0][1] as { signal?: unknown }
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })

  it('is reachable with no count when the payload is not an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    const r = await translateReachable('http://localhost:5000')
    expect(r).toEqual({ reachable: true, languages: undefined, message: 'Reachable.' })
  })

  it('reports not reachable when the fetch throws (service down/starting)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const r = await translateReachable('http://localhost:5000')
    expect(r.reachable).toBe(false)
  })

  it('reports not reachable on a non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }))
    const r = await translateReachable('http://localhost:5000')
    expect(r.reachable).toBe(false)
    expect(r.message).toMatch(/503/)
  })
})

describe('start/stopTranslate without a compose file', () => {
  it('startTranslate reports unavailable when no compose file is configured', async () => {
    delete process.env.RESUME_COMPOSE_FILE
    const r = await startTranslate()
    expect(r.ok).toBe(false)
    expect(r.available).toBe(false)
    expect(r.message).toMatch(/compose/i)
  })

  it('stopTranslate reports unavailable when no compose file is configured', async () => {
    delete process.env.RESUME_COMPOSE_FILE
    const r = await stopTranslate()
    expect(r.ok).toBe(false)
    expect(r.available).toBe(false)
  })

  it('a whitespace-only compose path counts as unconfigured — nothing is spawned', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', '   ')
    const r = await startTranslate()
    expect(r.available).toBe(false)
    expect(shell.calls).toHaveLength(0)
  })
})

describe('startTranslate with a compose file', () => {
  it('reports Docker missing when the daemon is unreachable', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push({ code: 1 })
    const r = await startTranslate()
    expect(r.ok).toBe(false)
    expect(r.available).toBe(false)
    expect(r.message).toMatch(/Docker is not available/)
    expect(shell.calls).toHaveLength(1)
  })

  it('starts the libretranslate compose service — exact argv', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push(dockerOk, { code: 0 })
    const r = await startTranslate()
    expect(r.ok).toBe(true)
    expect(r.available).toBe(true)
    expect(r.message).toContain('LibreTranslate container started.')
    expect(shell.calls.map((c) => c.cmd)).toEqual(['docker', 'docker'])
    expect(shell.calls[1].args).toEqual(['compose', '-f', COMPOSE, 'up', '-d', 'libretranslate'])
    expect(shell.calls[1].opts).toEqual({ windowsHide: true })
  })

  it('a failed start surfaces the trimmed stderr, capped at 400', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push(dockerOk, { code: 1, stderr: `  ${'x'.repeat(450)}  ` })
    const r = await startTranslate()
    expect(r.ok).toBe(false)
    expect(r.available).toBe(true)
    expect(r.message).toBe(`Failed to start LibreTranslate: ${'x'.repeat(400)}`)
  })

  it('a compose up that errors with no output reports the spawn failure, not an empty message', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push(dockerOk, { errorMessage: 'gone' })
    const r = await startTranslate()
    expect(r.ok).toBe(false)
    expect(r.message).toBe('Failed to start LibreTranslate: not found')
  })

  it('a failed start falls back to stdout when stderr is empty', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push(dockerOk, { code: 1, stdout: ' up went sideways ' })
    const r = await startTranslate()
    expect(r.message).toBe('Failed to start LibreTranslate: up went sideways')
  })
})

describe('stopTranslate with a compose file', () => {
  it('reports Docker missing when the daemon is unreachable', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push({ code: 1 })
    const r = await stopTranslate()
    expect(r).toEqual({ ok: false, available: false, message: 'Docker is not available.' })
  })

  it('stops the compose service — exact argv', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push(dockerOk, { code: 0 })
    const r = await stopTranslate()
    expect(r).toEqual({ ok: true, available: true, message: 'LibreTranslate container stopped.' })
    expect(shell.calls[1].args).toEqual(['compose', '-f', COMPOSE, 'stop', 'libretranslate'])
  })

  it('a failed stop surfaces the trimmed stderr, capped at 400', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push(dockerOk, { code: 1, stderr: `  ${'n'.repeat(450)}  ` })
    const r = await stopTranslate()
    expect(r.ok).toBe(false)
    expect(r.available).toBe(true)
    expect(r.message).toBe(`Failed to stop LibreTranslate: ${'n'.repeat(400)}`)
  })
})
