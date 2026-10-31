// Hash-based routes, so the browser's back button and Android's back gesture
// work without any extra code (SPEC.md, "Locus view and navigation").

export type Route =
  | { name: 'home' }
  | { name: 'locus'; id: string }
  // `sub`: a place inside the element, e.g. ['note', id] for one note in a notebook.
  | { name: 'element'; locusId: string; elementId: string; sub: string[] }
  | { name: 'review'; elementId: string }
  | { name: 'study'; locusId: string; start?: boolean; anyway?: boolean } // a locus's Study button: cards and problems together; `start` skips the length picker, `anyway` adds a day's new cards
  | { name: 'focus'; todoId: string } // the focus timer on a to-do
  | { name: 'tasks' }
  | { name: 'notes'; noteId?: string } // every note; with noteId, a loose note's editor
  | { name: 'settings' }

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'locus' && parts[1] && parts[2] === 'el' && parts[3]) return { name: 'element', locusId: parts[1], elementId: parts[3], sub: parts.slice(4) }
  if (parts[0] === 'locus' && parts[1]) return { name: 'locus', id: parts[1] }
  if (parts[0] === 'review' && parts[1]) return { name: 'review', elementId: parts[1] }
  if (parts[0] === 'study' && parts[1]) return { name: 'study', locusId: parts[1], ...(parts[2] === 'start' && { start: true }), ...(parts[2] === 'anyway' && { start: true, anyway: true }) }
  if (parts[0] === 'focus' && parts[1]) return { name: 'focus', todoId: parts[1] }
  if (parts[0] === 'tasks') return { name: 'tasks' }
  if (parts[0] === 'notes') return { name: 'notes', ...(parts[1] && { noteId: parts[1] }) }
  if (parts[0] === 'settings') return { name: 'settings' }
  return { name: 'home' }
}

export function currentRoute(): Route {
  return parseRoute(location.hash)
}

export function elementHash(el: { locusId: string; id: string }): string {
  return `#/locus/${encodeURIComponent(el.locusId)}/el/${encodeURIComponent(el.id)}`
}

// A place inside an element, e.g. one note: #/locus/…/el/…/note/<id>
export function subHash(el: { locusId: string; id: string }, ...sub: string[]): string {
  return `${elementHash(el)}/${sub.map(encodeURIComponent).join('/')}`
}

export function studyHash(locusId: string, mode?: 'start' | 'anyway'): string {
  return `#/study/${encodeURIComponent(locusId)}${mode ? `/${mode}` : ''}`
}

export function focusHash(todoId: string): string {
  return `#/focus/${encodeURIComponent(todoId)}`
}

// A loose note (in no locus) is opened from the Notes screen.
export function looseNoteHash(noteId: string): string {
  return `#/notes/${encodeURIComponent(noteId)}`
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
  if (route.name === 'notes' && route.noteId) return '#/notes'
  if (route.name === 'element' && route.sub.length > 0) return elementHash({ locusId: route.locusId, id: route.elementId })
  return route.name === 'element' ? `#/locus/${encodeURIComponent(route.locusId)}` : '#/'
}
