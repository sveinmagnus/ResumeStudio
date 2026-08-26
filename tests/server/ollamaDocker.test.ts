import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  listOllamaModels, isValidModelName, dockerAvailable, startOllama, stopOllama, ollamaReachable,
} from '../../server/ollamaDocker'

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

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

function mockFetch(resp: unknown) {
  const fn = vi.fn().mockResolvedValue(resp)
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('isValidModelName()', () => {
  it('accepts real Ollama tags', () => {
    expect(isValidModelName('llama3.2:3b')).toBe(true)
    expect(isValidModelName('my-org/custom:latest')).toBe(true)
  })
  it('rejects anything that could escape into argv', () => {
    expect(isValidModelName('a; rm -rf /')).toBe(false)
    expect(isValidModelName('$(whoami)')).toBe(false)
    expect(isValidModelName('')).toBe(false)
  })
  it('trims surrounding whitespace before validating', () => {
    expect(isValidModelName('  llama3.2:3b  ')).toBe(true)
  })
  it('anchors at the start — a hostile prefix cannot ride a valid tail', () => {
    expect(isValidModelName('!rm:latest')).toBe(false)
    expect(isValidModelName(';llama3.2:3b')).toBe(false)
  })
  it('caps the length at 81 characters', () => {
    expect(isValidModelName('a'.repeat(81))).toBe(true)
    expect(isValidModelName('a'.repeat(82))).toBe(false)
  })
})

describe('dockerAvailable()', () => {
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

describe('startOllama()', () => {
  it('reports unavailable without spawning when no compose file is configured', async () => {
    const r = await startOllama('llama3.2:3b')
    expect(r).toEqual({ ok: false, available: false, message: expect.stringMatching(/compose/i) as unknown })
    expect(shell.calls).toHaveLength(0)
  })

  it('treats a whitespace-only compose path as unconfigured', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', '   ')
    const r = await startOllama('llama3.2:3b')
    expect(r.available).toBe(false)
    expect(shell.calls).toHaveLength(0)
  })

  it('rejects an empty model before touching docker', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    const r = await startOllama('   ')
    expect(r.ok).toBe(false)
    expect(r.available).toBe(true)
    expect(r.message).toMatch(/valid model name/)
    expect(shell.calls).toHaveLength(0)
  })

  it('rejects an argv-hostile model name before touching docker', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    const r = await startOllama('bad name; rm -rf /')
    expect(r.ok).toBe(false)
    expect(r.available).toBe(true)
    expect(shell.calls).toHaveLength(0)
  })

  it('reports Docker missing when the daemon is unreachable', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push({ code: 1 })
    const r = await startOllama('llama3.2:3b')
    expect(r.ok).toBe(false)
    expect(r.available).toBe(false)
    expect(r.message).toMatch(/Docker is not available/)
    expect(shell.calls).toHaveLength(1)
  })

  it('starts the compose service then pulls the trimmed model — exact argv', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push(dockerOk, { code: 0 }, { code: 0 })
    const r = await startOllama('  llama3.2:3b ')
    expect(r.ok).toBe(true)
    expect(r.available).toBe(true)
    expect(r.message).toContain('llama3.2:3b')
    expect(shell.calls.map((c) => c.cmd)).toEqual(['docker', 'docker', 'docker'])
    expect(shell.calls[1].args).toEqual(['compose', '-f', COMPOSE, 'up', '-d', 'ollama'])
    expect(shell.calls[2].args).toEqual(['exec', 'resumestudio-ollama', 'ollama', 'pull', 'llama3.2:3b'])
  })

  it('a failed compose up surfaces the trimmed stderr (capped at 400) and skips the pull', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push(dockerOk, { code: 1, stderr: `  ${'x'.repeat(450)}  ` })
    const r = await startOllama('llama3.2:3b')
    expect(r.ok).toBe(false)
    expect(r.available).toBe(true)
    expect(r.message).toBe(`Failed to start Ollama: ${'x'.repeat(400)}`)
    expect(shell.calls).toHaveLength(2)
  })

  it('a compose up that errors with no output reports the spawn failure, not an empty message', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push(dockerOk, { errorMessage: 'gone' })
    const r = await startOllama('llama3.2:3b')
    expect(r.ok).toBe(false)
    expect(r.message).toBe('Failed to start Ollama: not found')
  })

  it('a failed compose up falls back to stdout when stderr is empty', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push(dockerOk, { code: 1, stdout: ' up went sideways ' })
    const r = await startOllama('llama3.2:3b')
    expect(r.message).toBe('Failed to start Ollama: up went sideways')
  })

  it('a failed pull names the model and caps the output at 300', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push(dockerOk, { code: 0 }, { code: 1, stderr: `  ${'e'.repeat(350)}  ` })
    const r = await startOllama('llama3.2:3b')
    expect(r.ok).toBe(false)
    expect(r.available).toBe(true)
    expect(r.message).toBe(`Ollama started but pulling "llama3.2:3b" failed: ${'e'.repeat(300)}`)
  })

  it('a failed pull falls back to stdout when stderr is empty', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push(dockerOk, { code: 0 }, { code: 1, stdout: ' pull went sideways ' })
    const r = await startOllama('llama3.2:3b')
    expect(r.message).toBe('Ollama started but pulling "llama3.2:3b" failed: pull went sideways')
  })
})

describe('stopOllama()', () => {
  it('reports unavailable without spawning when no compose file is configured', async () => {
    const r = await stopOllama()
    expect(r.ok).toBe(false)
    expect(r.available).toBe(false)
    expect(shell.calls).toHaveLength(0)
  })

  it('reports Docker missing when the daemon is unreachable', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push({ code: 1 })
    const r = await stopOllama()
    expect(r).toEqual({ ok: false, available: false, message: 'Docker is not available.' })
  })

  it('stops the compose service — exact argv', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push(dockerOk, { code: 0 })
    const r = await stopOllama()
    expect(r).toEqual({ ok: true, available: true, message: 'Ollama container stopped.' })
    expect(shell.calls[1].args).toEqual(['compose', '-f', COMPOSE, 'stop', 'ollama'])
  })

  it('a failed stop surfaces the trimmed stderr, capped at 400', async () => {
    vi.stubEnv('RESUME_COMPOSE_FILE', COMPOSE)
    shell.script.push(dockerOk, { code: 1, stderr: `  ${'n'.repeat(450)}  ` })
    const r = await stopOllama()
    expect(r.ok).toBe(false)
    expect(r.available).toBe(true)
    expect(r.message).toBe(`Failed to stop Ollama: ${'n'.repeat(400)}`)
  })
})

describe('listOllamaModels()', () => {
  it('maps /api/tags into name + size', async () => {
    mockFetch({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.2:3b', size: 2_000_000_000 }, { name: 'mistral:7b' }] }),
    })
    expect(await listOllamaModels('http://localhost:11434')).toEqual([
      { name: 'llama3.2:3b', size: 2_000_000_000 },
      { name: 'mistral:7b', size: undefined },
    ])
  })

  it('calls the instance tags endpoint, trimming a trailing slash', async () => {
    const fn = mockFetch({ ok: true, json: async () => ({ models: [] }) })
    await listOllamaModels('http://localhost:11434/')
    expect(fn.mock.calls[0][0]).toBe('http://localhost:11434/api/tags')
  })

  it('trims whitespace and collapses repeated trailing slashes in the URL', async () => {
    const fn = mockFetch({ ok: true, json: async () => ({ models: [] }) })
    await listOllamaModels('  http://localhost:11434//  ')
    expect(fn.mock.calls[0][0]).toBe('http://localhost:11434/api/tags')
  })

  it('passes an abort signal so a hung instance cannot hang the caller', async () => {
    const fn = mockFetch({ ok: true, json: async () => ({ models: [] }) })
    await listOllamaModels('http://localhost:11434')
    const opts = fn.mock.calls[0][1] as { signal?: unknown }
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })

  it('is empty (never throws) when the instance is down or erroring', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    await expect(listOllamaModels('http://localhost:11434')).resolves.toEqual([])

    mockFetch({ ok: false, status: 500 })
    await expect(listOllamaModels('http://localhost:11434')).resolves.toEqual([])
  })

  it('ignores the body of an error response even when it parses', async () => {
    mockFetch({ ok: false, status: 500, json: async () => ({ models: [{ name: 'x' }] }) })
    await expect(listOllamaModels('http://localhost:11434')).resolves.toEqual([])
  })

  it('is empty for a malformed payload rather than throwing', async () => {
    mockFetch({ ok: true, json: async () => ({ models: 'nope' }) })
    await expect(listOllamaModels('http://localhost:11434')).resolves.toEqual([])
  })

  it('drops entries with no usable name', async () => {
    mockFetch({ ok: true, json: async () => ({ models: [{ size: 1 }, { name: 'ok:1b' }] }) })
    expect(await listOllamaModels('http://localhost:11434')).toEqual([{ name: 'ok:1b', size: undefined }])
  })

  it('drops a non-numeric size instead of passing it through', async () => {
    mockFetch({ ok: true, json: async () => ({ models: [{ name: 'x', size: '2GB' }] }) })
    expect(await listOllamaModels('http://localhost:11434')).toEqual([{ name: 'x', size: undefined }])
  })

  it('refuses a non-http URL without making a request', async () => {
    const fn = mockFetch({ ok: true, json: async () => ({ models: [] }) })
    expect(await listOllamaModels('file:///etc/passwd')).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  it('requires the scheme at the START of the URL', async () => {
    const fn = mockFetch({ ok: true, json: async () => ({ models: [] }) })
    expect(await listOllamaModels('not-a-url http://localhost:11434')).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('ollamaReachable()', () => {
  it('refuses a non-http URL without making a request', async () => {
    const fn = mockFetch({ ok: true, json: async () => ({ models: [] }) })
    const r = await ollamaReachable('ftp://nope')
    expect(r.reachable).toBe(false)
    expect(r.message).toMatch(/http/i)
    expect(fn).not.toHaveBeenCalled()
  })

  it('reports the model count from a normalized URL', async () => {
    const fn = mockFetch({ ok: true, json: async () => ({ models: [{}, {}, {}] }) })
    const r = await ollamaReachable('  http://localhost:11434/  ')
    expect(fn.mock.calls[0][0]).toBe('http://localhost:11434/api/tags')
    expect(r).toEqual({ reachable: true, models: 3, message: 'Reachable — 3 model(s) available.' })
  })

  it('is reachable with no count when the payload has no models array', async () => {
    mockFetch({ ok: true, json: async () => ({}) })
    const r = await ollamaReachable('http://localhost:11434')
    expect(r).toEqual({ reachable: true, models: undefined, message: 'Reachable.' })
  })

  it('reports the HTTP status on a non-200 response', async () => {
    mockFetch({ ok: false, status: 503 })
    const r = await ollamaReachable('http://localhost:11434')
    expect(r.reachable).toBe(false)
    expect(r.message).toContain('503')
  })

  it('is not reachable (never throws) when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const r = await ollamaReachable('http://localhost:11434')
    expect(r.reachable).toBe(false)
    expect(r.message).toMatch(/Not reachable/)
  })
})
