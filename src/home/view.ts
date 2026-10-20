// The home screen: the bubble field, a top bar with the Tasks button and the tag
// filter, and the + button.
// It stays in the page while other screens cover it, so the bubbles keep their
// places (and motion) when you come back.

import { PALETTE } from '../colors'
import { h } from '../dom'
import type { Task } from '../elements/registry'
import { tasksIcon } from '../icons'
import { createLocus, deleteLocus, findOrCreateTag, listLoci, listTags, moveLocus, updateLocus } from '../store/db'
import type { Locus, Tag } from '../types'
import { type LocusDraft, openLocusSheet } from './createLocus'
import { createField, type Field, spiralPoint } from './field'
import { createTagFilter } from './filter'

export interface Home {
  el: HTMLElement
  field: Field
  refresh(): Promise<void>
  // The current tasks: their loci pulse, and the badge counts them.
  setTasks(tasks: Task[]): void
}

export function createHome(options: { onOpen(locus: Locus): void; onTasks(): void }): Home {
  const field = createField({
    onTap: options.onOpen,
    onMove: (locus, x, y) => void moveLocus(locus.id, x, y),
    onLongPress: (locus) => void onEdit(locus),
  })
  const empty = h('p', { class: 'empty' }, 'No loci yet. Tap + to create your first one.')
  const filter = createTagFilter(() => applyFilter())

  const badge = h('span', { class: 'badge', hidden: true })
  const tasksButton = h('button', { type: 'button', class: 'tasks-btn', onclick: options.onTasks }, tasksIcon(), h('span', {}, 'Tasks'), badge)

  let loci: Locus[] = []
  let tasks: Task[] = []

  // The tag filter greys out other loci, and focuses the badge on what's left.
  function applyFilter() {
    const tagId = filter.selected()
    const outside = new Set(tagId ? loci.filter((l) => !l.tagIds.includes(tagId)).map((l) => l.id) : [])
    field.setDimmed(outside)
    field.setActive(new Set(tasks.map((t) => t.locusId)))
    const count = tasks.filter((t) => !outside.has(t.locusId)).length
    badge.hidden = count === 0
    badge.textContent = count > 99 ? '99+' : String(count)
    tasksButton.setAttribute('aria-label', count === 0 ? 'Tasks, nothing due' : `Tasks, ${count} due`)
  }

  function setTasks(next: Task[]) {
    tasks = next
    applyFilter()
  }

  async function refresh() {
    const tags = await listTags()
    loci = await listLoci()
    field.render(loci)
    filter.render(tags)
    applyFilter()
    empty.hidden = loci.length > 0
  }

  async function resolveTagIds(draft: LocusDraft): Promise<string[]> {
    const created: Tag[] = []
    for (const name of draft.newTags) created.push(await findOrCreateTag(name))
    return [...new Set([...draft.tagIds, ...created.map((t) => t.id)])]
  }

  async function onCreate() {
    const count = loci.length
    const result = await openLocusSheet({ tags: await listTags(), suggestedColor: PALETTE[count % PALETTE.length] })
    if (result?.action !== 'save') return
    const { draft } = result
    const { width, height } = field.el.getBoundingClientRect()
    await createLocus({ name: draft.name, color: draft.color, tagIds: await resolveTagIds(draft), ...spiralPoint(count, width, height) })
    await refresh()
  }

  async function onEdit(locus: Locus) {
    const result = await openLocusSheet({ locus, tags: await listTags(), suggestedColor: locus.color })
    if (!result) return
    if (result.action === 'delete') {
      await deleteLocus(locus.id)
    } else {
      const { draft } = result
      await updateLocus(locus.id, { name: draft.name, color: draft.color, tagIds: await resolveTagIds(draft) })
    }
    await refresh()
  }

  const el = h(
    'div',
    { class: 'home' },
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-row' }, h('h1', { class: 'brand' }, 'Loci'), tasksButton), filter.el),
    field.el,
    empty,
    h('button', { class: 'fab', 'aria-label': 'New locus', onclick: onCreate }, '+'),
  )

  return { el, field, refresh, setTasks }
}
