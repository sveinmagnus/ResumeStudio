/**
 * Registers the shell-only service worker (`src/sw.js`) and owns its update
 * prompt.
 *
 * Entered from its own `<script type="module">` in index.html, so none of it
 * depends on the React tree — which is also why the prompt is raw DOM: there is
 * no root to mount into. It reads the design tokens, so it still matches.
 */

const BANNER_ID = 'sw-update'

const BUTTON_STYLE = 'padding:5px 12px;border-radius:var(--r-sm);font-size:12.5px;font-weight:600;'

function promptReload(worker: ServiceWorker): void {
  if (document.getElementById(BANNER_ID)) return

  const bar = document.createElement('div')
  bar.id = BANNER_ID
  bar.setAttribute('role', 'status')
  bar.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);'
    + 'z-index:60;display:flex;align-items:center;gap:12px;padding:10px 14px;'
    + 'border-radius:var(--r-md);background:var(--paper-raised);border:1px solid var(--line);'
    + 'box-shadow:var(--shadow-md);font-size:13px;color:var(--ink);'

  const text = document.createElement('span')
  text.textContent = 'A newer version of Resume Studio is ready.'

  const reload = document.createElement('button')
  reload.type = 'button'
  reload.textContent = 'Reload'
  reload.style.cssText = `${BUTTON_STYLE}background:var(--accent);color:#fff;`
  // The reload itself waits for `controllerchange`: the new worker has not
  // taken over yet, so reloading here would just re-run the old code.
  reload.addEventListener('click', () => worker.postMessage({ type: 'SKIP_WAITING' }))

  const later = document.createElement('button')
  later.type = 'button'
  later.textContent = 'Later'
  later.style.cssText = `${BUTTON_STYLE}color:var(--ink-soft);`
  later.addEventListener('click', () => bar.remove())

  bar.append(text, reload, later)
  document.body.append(bar)
}

function watchForUpdate(registration: ServiceWorkerRegistration): void {
  // An install with no controller is the FIRST one: no stale code is running,
  // so there is nothing to prompt about.
  if (registration.waiting && navigator.serviceWorker.controller) promptReload(registration.waiting)

  registration.addEventListener('updatefound', () => {
    const next = registration.installing
    if (!next) return
    next.addEventListener('statechange', () => {
      if (next.state === 'installed' && navigator.serviceWorker.controller) promptReload(next)
    })
  })
}

function register(): void {
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Chrome can fire this more than once for a single swap.
    if (reloading) return
    reloading = true
    location.reload()
  })

  void navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .then(watchForUpdate)
    // A worker that won't register costs offline load and nothing else; the
    // app is fully functional without one.
    .catch(() => {})
}

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', register)
  } else {
    // A worker left from a production build served on this same origin would
    // answer with a precached shell and defeat HMR.
    void navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {})
  }
}
