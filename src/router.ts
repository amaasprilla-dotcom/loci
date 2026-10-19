// Hash-based routes, so the browser's back button and Android's back gesture
// work without any extra code (SPEC.md, "Locus view and navigation").
// More routes (deck, review, tasks) arrive with their milestones.

export type Route = { name: 'home' } | { name: 'locus'; id: string }

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'locus' && parts[1]) return { name: 'locus', id: parts[1] }
  return { name: 'home' }
}

export function currentRoute(): Route {
  return parseRoute(location.hash)
}

// Navigate inside the app. The new history entry is marked, so a screen's own
// back button knows it can simply go back rather than jump home.
export function go(hash: string): void {
  if (location.hash === hash) return
  location.hash = hash
  history.replaceState({ inApp: true }, '')
}

// What a screen's back button does: step back if we came from inside the app,
// otherwise (opened from a bookmark or after a reload) replace this page with home.
export function back(): void {
  if ((history.state as { inApp?: boolean } | null)?.inApp) history.back()
  else location.replace('#/')
}
