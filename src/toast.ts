// A short message at the bottom of the screen that goes away by itself,
// e.g. "Deleted on another device".

import { h } from './dom'

const SHOW_MS = 3500

export function toast(message: string): void {
  document.querySelector('.toast')?.remove()
  const el = h('div', { class: 'toast', role: 'status' }, message)
  document.body.append(el)
  setTimeout(() => el.remove(), SHOW_MS)
}
