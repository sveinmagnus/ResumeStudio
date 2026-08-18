import { describe, it, expect, afterEach } from 'vitest'
import net from 'net'
import { findFreePort } from '../../server/desktop/freePort'

// The desktop build asks for port 80 first (so a configured local name needs no
// `:port` suffix) and must fall to the documented 1923 when something already
// owns it — a machine running IIS is the normal case, not the exotic one.

const servers: net.Server[] = []

function occupy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => { servers.push(srv); resolve(true) })
    srv.listen(port, '127.0.0.1')
  })
}

afterEach(() => {
  while (servers.length) servers.pop()?.close()
})

describe('findFreePort()', () => {
  it('takes the first candidate that binds', async () => {
    const port = await findFreePort([45311, 45312], '127.0.0.1', 0)
    expect(port).toBe(45311)
  })

  it('falls to the NEXT named candidate, not to first+1', async () => {
    expect(await occupy(45311)).toBe(true)
    const port = await findFreePort([45311, 45312], '127.0.0.1', 0)
    expect(port).toBe(45312)
  })

  it('ladders above the last candidate once the named ones are taken', async () => {
    expect(await occupy(45311)).toBe(true)
    expect(await occupy(45312)).toBe(true)
    const port = await findFreePort([45311, 45312], '127.0.0.1', 20)
    expect(port).toBeGreaterThan(45312)
  })

  // span 0 is what an explicitly pinned port uses: rather than creeping to
  // port+1 behind the user's back, it lands on an OS-assigned port and the
  // launcher says so.
  it('with span 0 and everything taken, returns an ephemeral port', async () => {
    expect(await occupy(45311)).toBe(true)
    const port = await findFreePort([45311], '127.0.0.1', 0)
    expect(port).not.toBe(45311)
    expect(port).toBeGreaterThan(0)
  })

  it('still accepts a single number, as the old callers passed', async () => {
    expect(await findFreePort(45313, '127.0.0.1', 0)).toBe(45313)
  })
})
