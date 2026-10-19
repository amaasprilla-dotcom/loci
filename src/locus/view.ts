// The locus screen: a header tinted in the locus color (back button, name, tags)
// and, below it, the locus's elements. Element tiles and the + menu arrive in milestone 5.

import { textColorOn } from '../colors'
import { h } from '../dom'
import { db } from '../store/db'
import type { Locus } from '../types'

const backIcon = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
  return svg
}

export async function renderLocusView(locus: Locus, options: { onBack(): void }): Promise<HTMLElement> {
  const tags = (await db.tags.bulkGet(locus.tagIds)).filter((t) => t != null)

  return h(
    'div',
    { class: 'locus-view', style: { '--c': locus.color, '--fg': textColorOn(locus.color) } },
    h(
      'header',
      { class: 'locus-header' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: options.onBack }, backIcon()),
      h(
        'div',
        { class: 'locus-title' },
        h('h1', {}, locus.name),
        tags.length > 0 && h('div', { class: 'locus-tags' }, tags.map((t) => h('span', { class: 'tag' }, t.name))),
      ),
    ),
    h('main', { class: 'locus-body' }, h('p', { class: 'locus-empty' }, 'Nothing in this locus yet.')),
  )
}
