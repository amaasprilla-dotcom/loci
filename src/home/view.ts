// The home screen: the bubble field, a top bar and the + button.
// It stays in the page while other screens cover it, so the bubbles keep their
// places (and motion) when you come back.

import { PALETTE } from '../colors'
import { h } from '../dom'
import { createLocus, listLoci, moveLocus } from '../store/db'
import type { Locus } from '../types'
import { createField, type Field, spiralPoint } from './field'
import { openCreateLocusSheet } from './createLocus'

export interface Home {
  el: HTMLElement
  field: Field
  refresh(): Promise<void>
}

export function createHome(options: { onOpen(locus: Locus): void }): Home {
  const field = createField({
    onTap: options.onOpen,
    onMove: (locus, x, y) => void moveLocus(locus.id, x, y),
  })
  const empty = h('p', { class: 'empty' }, 'No loci yet. Tap + to create your first one.')

  async function refresh() {
    const loci = await listLoci()
    field.render(loci)
    empty.hidden = loci.length > 0
  }

  async function onCreate() {
    const count = (await listLoci()).length
    const draft = await openCreateLocusSheet(PALETTE[count % PALETTE.length])
    if (!draft) return
    const { width, height } = field.el.getBoundingClientRect()
    await createLocus({ ...draft, ...spiralPoint(count, width, height) })
    await refresh()
  }

  const el = h(
    'div',
    { class: 'home' },
    h('header', { class: 'topbar' }, h('h1', { class: 'brand' }, 'Loci')),
    field.el,
    empty,
    h('button', { class: 'fab', 'aria-label': 'New locus', onclick: onCreate }, '+'),
  )

  return { el, field, refresh }
}
