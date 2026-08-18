/**
 * Find a free TCP port for the local server.
 *
 * A desktop app can't assume 3001 is free (another instance, an unrelated dev
 * server, …). We try the preferred port and a short ladder above it, then fall
 * back to an OS-assigned ephemeral port. The chosen port is written into the
 * URL the launcher opens, so the user always lands on the right tab.
 */

import net from 'net'

/** Resolve a port number if `host:port` can be bound, else null. */
function tryBind(port: number, host: string): Promise<number | null> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(null))
    srv.once('listening', () => {
      const addr = srv.address()
      const chosen = typeof addr === 'object' && addr ? addr.port : port
      srv.close(() => resolve(chosen))
    })
    srv.listen(port, host)
  })
}

/**
 * Try each `preferred` port in order, then a short ladder above the LAST one,
 * then port 0 (OS picks). Resolves with the first port that binds; rejects only
 * if even an ephemeral port can't be obtained (effectively never).
 *
 * Several preferred ports rather than one because the desktop build wants port
 * 80 (so the configured name needs no `:port` suffix) but must not depend on
 * getting it: plenty of machines already run IIS, another dev server, or an OS
 * that reserves the port. Each candidate is tried exactly as given, and only the
 * last one gets the +1.. ladder, so a taken 80 falls to the documented 1923
 * rather than to 81.
 */
export async function findFreePort(
  preferred: number | number[],
  host = '127.0.0.1',
  span = 20,
): Promise<number> {
  const candidates = Array.isArray(preferred) ? preferred : [preferred]
  const last = candidates[candidates.length - 1]
  for (const p of candidates.slice(0, -1)) {
    const ok = await tryBind(p, host)
    if (ok) return ok
  }
  for (let p = last; p <= last + span; p++) {
    const ok = await tryBind(p, host)
    if (ok) return ok
  }
  const ephemeral = await tryBind(0, host)
  if (ephemeral) return ephemeral
  throw new Error('Could not find a free port to bind to')
}
