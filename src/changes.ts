// "Something changed": for edits made in a sheet that can open over any screen
// (e.g. an exam from the Tasks screen), so whatever is showing redraws.

const EVENT = 'loci:changed'

export function announceChange(): void {
  window.dispatchEvent(new Event(EVENT))
}

export function onChange(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
