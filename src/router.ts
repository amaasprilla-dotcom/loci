// Hash-based routes, so the browser's back button and Android's back gesture
// work without any extra code (SPEC.md, "Locus view and navigation").

export type Route =
  | { name: 'home' }
  | { name: 'locus'; id: string }
  | { name: 'element'; locusId: string; elementId: string }
  | { name: 'review'; elementId: string }
  | { name: 'tasks' }

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'locus' && parts[1] && parts[2] === 'el' && parts[3]) return { name: 'element', locusId: parts[1], elementId: parts[3] }
  if (parts[0] === 'locus' && parts[1]) return { name: 'locus', id: parts[1] }
  if (parts[0] === 'review' && parts[1]) return { name: 'review', elementId: parts[1] }
  if (parts[0] === 'tasks') return { name: 'tasks' }
  return { name: 'home' }
}

export function currentRoute(): Route {
  return parseRoute(location.hash)
}

export function elementHash(el: { locusId: string; id: string }): string {
  return `#/locus/${encodeURIComponent(el.locusId)}/el/${encodeURIComponent(el.id)}`
}

export function reviewHash(el: { id: string }): string {
  return `#/review/${encodeURIComponent(el.id)}`
}

// Navigate inside the app. The new history entry is marked, so a screen's own
// back button knows it can simply go back rather than jump home.
export function go(hash: string): void {
  if (location.hash === hash) return
  location.hash = hash
  history.replaceState({ inApp: true }, '')
}

// What a screen's back button does: step back if we came from inside the app,
// otherwise (opened from a bookmark or after a reload) replace this page with
// its parent screen.
export function back(parent = '#/'): void {
  if ((history.state as { inApp?: boolean } | null)?.inApp) history.back()
  else location.replace(parent)
}

// The screen that back leads to when there's no history to go back through.
export function parentOf(route: Route): string {
  return route.name === 'element' ? `#/locus/${encodeURIComponent(route.locusId)}` : '#/'
}
