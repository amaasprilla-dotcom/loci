// The Tasks screen: everything due, across every locus, grouped by locus.
// Tapping a task starts it (for a deck, the review). Follows the home tag filter.

import { h } from '../dom'
import type { Task } from '../elements/registry'
import { getTagFilter, setTagFilter } from '../home/filter'
import { backIcon, chevronIcon, closeIcon } from '../icons'
import { back } from '../router'
import { db } from '../store/db'
import { formatIn } from '../time'
import type { Locus } from '../types'
import { nextUpcoming } from './tasks'

export interface TasksScreen {
  el: HTMLElement
  // Called with fresh tasks on every refresh (start, navigation, every minute).
  update(tasks: Task[]): Promise<void>
}

export function createTasksScreen(): TasksScreen {
  const summary = h('p', { class: 'tasks-summary' })
  const filterNote = h('div', { class: 'tasks-filter' })
  const body = h('div', { class: 'tasks-body' })
  let last: Task[] = []

  async function update(tasks: Task[]) {
    last = tasks
    const now = Date.now()
    const [loci, elements, tags] = await Promise.all([db.loci.toArray(), db.elements.toArray(), db.tags.toArray()])
    const locusById = new Map(loci.map((l) => [l.id, l]))
    const titleById = new Map(elements.map((e) => [e.id, e.title]))

    // The home tag filter applies here too.
    const tag = tags.find((t) => t.id === getTagFilter())
    const inFilter = tag ? new Set(loci.filter((l) => l.tagIds.includes(tag.id)).map((l) => l.id)) : undefined
    const shown = tasks.filter((t) => locusById.has(t.locusId) && (!inFilter || inFilter.has(t.locusId)))

    filterNote.replaceChildren(
      ...(tag
        ? [
            h('span', {}, 'Showing loci tagged'),
            h(
              'button',
              {
                type: 'button',
                class: 'chip',
                'aria-pressed': 'true',
                'aria-label': `Clear the ${tag.name} filter`,
                onclick: () => {
                  setTagFilter(null)
                  void update(last)
                },
              },
              tag.name,
              closeIcon(),
            ),
          ]
        : []),
    )
    filterNote.hidden = !tag

    const cards = shown.reduce((sum, t) => sum + (t.count ?? 0), 0)
    summary.textContent =
      shown.length === 0 ? '' : `${shown.length} ${shown.length === 1 ? 'task' : 'tasks'}` + (cards > 0 ? ` · ${cards} ${cards === 1 ? 'card' : 'cards'} due` : '')

    if (shown.length === 0) {
      const next = await nextUpcoming(now, inFilter)
      body.replaceChildren(
        h(
          'div',
          { class: 'tasks-empty' },
          h('h2', {}, tag ? `Nothing due in ${tag.name}.` : 'Nothing due.'),
          h('p', {}, next ? `Next: ${next.title} ${formatIn(next.at - now)}.` : 'Nothing is scheduled yet.'),
        ),
      )
      return
    }

    // Group by locus, keeping the order tasks came in (soonest first).
    const groups = new Map<string, Task[]>()
    for (const t of shown) groups.set(t.locusId, [...(groups.get(t.locusId) ?? []), t])
    body.replaceChildren(...[...groups].map(([locusId, list]) => group(locusById.get(locusId)!, list, titleById)))
  }

  function group(locus: Locus, tasks: Task[], titles: Map<string, string>): HTMLElement {
    return h(
      'section',
      { class: 'task-group' },
      h('h2', { class: 'task-group-title' }, h('span', { class: 'dot', style: { '--c': locus.color } }), locus.name),
      h(
        'div',
        { class: 'task-list' },
        tasks.map((t) =>
          h(
            'button',
            { type: 'button', class: 'task-row', onclick: () => t.action() },
            h('span', { class: 'task-text' }, h('strong', {}, titles.get(t.elementId) ?? ''), h('span', { class: 'task-label' }, ` · ${t.label}`)),
            chevronIcon(),
          ),
        ),
      ),
    )
  }

  const el = h(
    'div',
    { class: 'tasks-screen' },
    h(
      'header',
      { class: 'tasks-header' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => back() }, backIcon()),
      h('div', { class: 'locus-title' }, h('h1', {}, 'Tasks'), summary),
    ),
    h('main', { class: 'locus-body' }, filterNote, body),
  )

  return { el, update }
}
