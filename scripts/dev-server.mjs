#!/usr/bin/env node
/**
 * Dev entry for the API server. Wiring only — it sets one env var and hands off
 * to `server/index.ts`, which stays the single dev/VPS entry (CLAUDE.md §14).
 *
 * It exists because some launchers inject `PORT` to tell the CLIENT which port
 * to serve on, and `server/index.ts` reads that same variable. Under the
 * in-app browser preview (which injects `PORT=5173`) Express won the race for
 * 5173, Vite shifted to 5174, and Vite's `/api` proxy went on pointing at 3001
 * where nothing listened — so the app loaded and every request failed with
 * "cannot connect to server". An injected PORT means the client's port, never
 * this process's.
 *
 * `RESUME_SERVER_PORT` is the deliberate override, so the API port is settable
 * without going through the variable the client also claims.
 */
process.env.PORT = process.env.RESUME_SERVER_PORT ?? '3001'

await import('../server/index.ts')
