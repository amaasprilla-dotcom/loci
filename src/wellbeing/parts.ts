// The pieces the Wellbeing cards are made of.

import { h } from '../dom'
import { formatTime } from '../elements/todos/when'

// One part of the screen: a title with its switch, a line on what it does, and the
// options, folded away while it's off.
export function card(title: string, about: string, toggle: { on: boolean; onchange(on: boolean): void } | null, ...body: (HTMLElement | null)[]): HTMLElement {
  const options = h('div', { class: 'wb-options' }, ...body)
  let head: HTMLElement = h('h2', {}, title)
  if (toggle) {
    options.hidden = !toggle.on
    const sw = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(toggle.on), 'aria-label': title, onclick: () => {
      const on = sw.getAttribute('aria-checked') !== 'true'
      sw.setAttribute('aria-checked', String(on))
      options.hidden = !on
      toggle.onchange(on)
    } }, h('span', { class: 'switch-knob' }))
    head = h('div', { class: 'wb-head' }, head, sw)
  }
  return h('section', { class: 'settings-section wb-card' }, head, h('p', { class: 'settings-note' }, about), options)
}

export const update = (version: string, title: string, what: string) =>
  h('section', { class: 'settings-section wb-card' }, h('h2', {}, title), h('p', { class: 'settings-note' }, `Install the new Loci app (${version} or later) over this one for ${what}.`))

// One toggle per day, Monday first (0 = Sunday, as Date.getDay).
export function dayToggles(label: string, days: number[], onchange: (days: number[]) => void): HTMLElement {
  const dayName = (d: number) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(2026, 10, 1 + d)) // 1 Nov 2026 was a Sunday
  let on = [...days]
  const buttons = [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const b = h('button', { type: 'button', class: 'segment', 'aria-pressed': String(on.includes(d)), onclick: () => {
      on = on.includes(d) ? on.filter((n) => n !== d) : [...on, d].sort((x, y) => x - y)
      b.setAttribute('aria-pressed', String(on.includes(d)))
      onchange(on)
    } }, dayName(d))
    return b
  })
  return h('div', { class: 'segments phone-nights', role: 'group', 'aria-label': label }, buttons)
}

// "12:00", or "midnight" for the end of the day.
export function until(t: number): string {
  const d = new Date(t)
  return d.getHours() === 0 && d.getMinutes() === 0 ? 'midnight' : formatTime(t)
}
