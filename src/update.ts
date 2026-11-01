/// <reference types="vite-plugin-pwa/vanillajs" />
// New versions. The service worker keeps a copy of every file so the app opens with no
// connection, which means the first open after a deploy still runs the old copy while the
// new one installs in the background. Once it has, this reloads into it at a quiet moment:
// right away if nothing is being written, else when you change screens or leave the app.
// It also looks for a new version whenever the app comes back into view, since a phone
// can keep it open for days.

import { registerSW } from 'virtual:pwa-register'
import { isEditing } from './sync/editing'

// Something a reload would lose: a field in use, an open editor or sheet, a half-written to-do.
function busy(): boolean {
  const el = document.activeElement
  const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)
  return typing || isEditing() || !!document.querySelector('.sheet, .todo-add.open')
}

export function keepUpToDate(): void {
  let ready = false
  const reloadIfQuiet = () => {
    if (ready && !busy()) location.reload()
  }
  registerSW({
    immediate: true,
    onNeedReload() {
      ready = true
      reloadIfQuiet()
    },
    onRegisteredSW(_url, registration) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration?.update().catch(() => {})
      })
    },
  })
  document.addEventListener('visibilitychange', reloadIfQuiet)
  window.addEventListener('hashchange', reloadIfQuiet)
}
