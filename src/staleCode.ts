// Some screens' code loads the first time they open (import()). If that file is
// gone (a new version was deployed while the app was open, or the dev server
// restarted), the import fails and the tap seems to do nothing. Reloading picks
// up the current files and lands on the same screen, since the route is in the URL.
// Only once in a short while, so a file that's truly missing can't reload forever.

const KEY = 'loci:stale-code-reload'
const AGAIN_AFTER_MS = 10_000

// The browsers' messages for a module that failed to fetch, plus Vite's for its CSS.
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|Unable to preload CSS/i

export function isStaleCodeError(err: unknown): boolean {
  return err instanceof Error && CHUNK_ERROR.test(err.message)
}

// Reloads if that's worth a try. Returns false if it just did, so the caller reports the error.
export function reloadForStaleCode(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY))
    if (Date.now() - last < AGAIN_AFTER_MS) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    return false // no storage, no way to tell a second try from the first: don't risk a loop
  }
  location.reload()
  return true
}

// Covers imports nothing awaits, such as a sheet opened from a task row.
// (Vite's own vite:preloadError is left alone: preventing it makes the import
// resolve to undefined instead of failing, which breaks the caller.)
export function watchForStaleCode(): void {
  window.addEventListener('unhandledrejection', (e) => {
    if (isStaleCodeError(e.reason) && reloadForStaleCode()) e.preventDefault()
  })
}
