// The Tasks screen (SPEC-v2.md, "Tasks screen v2"): everything across every locus,
// in four sections. Due: active tasks by priority, late ones say so in plain text. Planned:
// greyed but still tickable. Someday: greyed, collapsed. Goals and exams: last, never red.
// Follows the home tag filter. At the top, a to-do can be added straight here: a loose
// one, in no locus (it shows under any filter, since it has no tags).

import { h } from '../dom'
import type { Task } from '../elements/registry'
import { getTagFilter, setTagFilter } from '../home/filter'
import { backIcon, chevronIcon, closeIcon } from '../icons'
import { levelName } from '../levels'
import { back } from '../router'
import { db } from '../store/db'
import { formatIn } from '../time'
import type { Locus } from '../types'
import { nextUpcoming, type Section, sections } from './tasks'
import { count } from '../locale'
import { daysLate } from '../now/candidates'
import { logEvent } from '../now/events'

export interface TasksScreen {
  el: HTMLElement
  // Called with fresh tasks on every refresh (start, navigation, every minute).
  update(tasks: Task[]): Promise<void>
  // A fresh add form, each time the screen is opened.
  resetAddForm(): Promise<void>
}

// Loose to-dos have no locus; they draw as one in a quiet grey, with no name.
export const NO_LOCUS: Pick<Locus, 'name' | 'color'> = { name: '', color: '#9aa5b1' }

const SECTION_TITLES: Record<Section, string> = { now: 'Due', goals: 'Goals and exams', planned: 'Planned', someday: 'Someday' }

export function createTasksScreen(onChanged: () => void): TasksScreen {
  const filterNote = h('div', { class: 'tasks-filter' })
  const body = h('div', { class: 'tasks-body' })
  let addForm: HTMLElement = h('div')
  let last: Task[] = []
  let somedayOpen = false

  async function update(tasks: Task[]) {
    last = tasks
    const now = Date.now()
    const [loci, elements, tags] = await Promise.all([db.loci.toArray(), db.elements.toArray(), db.tags.toArray()])
    const locusById = new Map(loci.map((l) => [l.id, l]))
    const titleById = new Map(elements.map((e) => [e.id, e.title]))

    // The home tag filter applies here too.
    const tag = tags.find((t) => t.id === getTagFilter())
    const inFilter = tag ? new Set(loci.filter((l) => l.tagIds.includes(tag.id)).map((l) => l.id)) : undefined
    const shown = tasks.filter((t) => t.locusId === '' || (locusById.has(t.locusId) && (!inFilter || inFilter.has(t.locusId))))
    const s = sections(shown)

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

    const row = (t: Task) => taskRow(t, locusById.get(t.locusId) ?? NO_LOCUS, titleById.get(t.elementId) ?? '', async () => {
      await logEvent('done', t, { rank: 0 }) // not from the card
      await t.complete?.()
      onChanged()
    })

    const nowList = s.now.length > 0 ? taskList(s.now.map(row)) : await emptyNow(now, inFilter, tag?.name)
    // Goals and exams go last, under every task, so they're always in the same place.
    const parts: (HTMLElement | false)[] = [
      section('now', nowList),
      s.planned.length > 0 && section('planned', taskList(s.planned.map(row)), 'muted'),
      s.someday.length > 0 &&
        h(
          'details',
          {
            class: 'task-section muted',
            open: somedayOpen,
            ontoggle: (e: Event) => (somedayOpen = (e.target as HTMLDetailsElement).open),
          },
          h('summary', { class: 'task-section-title' }, `${SECTION_TITLES.someday} (${s.someday.length})`),
          taskList(s.someday.map(row)),
        ),
      s.goals.length > 0 && section('goals', taskList(s.goals.map(row))),
    ]
    body.replaceChildren(...parts.filter((p): p is HTMLElement => p !== false))
  }

  const el = h(
    'div',
    { class: 'tasks-screen' },
    h(
      'header',
      { class: 'locus-header' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => back() }, backIcon()),
      h('div', { class: 'locus-title' }, h('span', { class: 'header-kicker' }, 'Every locus'), h('h1', {}, 'Tasks')),
    ),
    h('main', { class: 'locus-body' }, addForm, filterNote, body),
  )

  async function resetAddForm() {
    const { createAddForm } = await import('../elements/todos/screens')
    const fresh = createAddForm('', async () => onChanged())
    // Quick capture: one line until it's used, then the rest of the form.
    fresh.classList.add('tasks-add')
    fresh.addEventListener('focusin', () => fresh.classList.add('open'))
    addForm.replaceWith(fresh)
    addForm = fresh
  }

  return { el, update, resetAddForm }
}

function section(which: Section, content: Node, extraClass = ''): HTMLElement {
  return h('section', { class: `task-section ${extraClass}` }, h('h2', { class: 'task-section-title' }, SECTION_TITLES[which]), content)
}

function taskList(rows: HTMLElement[]): HTMLElement {
  return h('div', { class: 'task-list' }, rows)
}

async function emptyNow(now: number, inFilter: Set<string> | undefined, tagName?: string): Promise<HTMLElement> {
  const next = await nextUpcoming(now, inFilter)
  return h(
    'div',
    { class: 'tasks-empty' },
    h('p', { class: 'tasks-empty-title' }, tagName ? `Nothing to do now in ${tagName}.` : 'Nothing to do now.'),
    h('p', {}, next ? `Next: ${next.title} ${formatIn(next.at - now)}.` : 'Nothing is scheduled yet.'),
  )
}

// One task: its locus (color dot and name), what to do, and when. Tap opens it;
// the tick box (when the task can be completed) completes it; a second action
// (e.g. "It happened") gets its own button.
// `showLocus: false` inside a locus's own screens, where the locus goes without saying.
export function taskRow(
  t: Task,
  locus: Pick<Locus, 'name' | 'color'>,
  elementTitle: string,
  onComplete: () => Promise<void>,
  { showLocus = true, onSecondary }: { showLocus?: boolean; onSecondary?: () => void | Promise<void> } = {},
): HTMLElement {
  // A deck's or set's own study task names it; a locus's Study task stands alone.
  const title = t.kind === 'review' && t.elementId ? `${elementTitle} · ${t.label}` : t.label
  const priority = t.kind === 'todo' && t.importance >= 3 ? levelName('importance', t.importance) : ''
  // Late is plain secondary text, not an alarm (SPEC-v5-now.md, "Signals").
  const late = t.kind === 'todo' && t.state === 'overdue' && t.dueAt != null ? `${count(daysLate(t.dueAt, Date.now()), 'day', 'days')} late` : ''
  const details = [showLocus && locus.name, t.sublabel, late, priority].filter(Boolean).join(' · ')
  return h(
    'div',
    { class: `task-row ${t.state === 'overdue' ? 'overdue' : ''}`, style: { '--c': locus.color } },
    t.complete &&
      h('button', {
        type: 'button',
        class: 'task-check',
        'aria-label': `Done: ${t.label}`,
        onclick: () => void onComplete(),
      }),
    h(
      'button',
      { type: 'button', class: 'task-main', onclick: () => t.open() },
      h('span', { class: 'dot' }),
      h(
        'span',
        { class: 'task-text' },
        h('span', { class: 'task-title' }, title),
        h('span', { class: 'task-details' }, details),
        t.progress != null &&
          h('span', { class: 'progress' }, h('span', { class: 'progress-fill', style: { width: `${Math.round(t.progress * 100)}%` } })),
      ),
      chevronIcon(),
    ),
    t.secondary &&
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small task-secondary',
          onclick: async () => {
            await t.secondary!.run()
            await onSecondary?.()
          },
        },
        t.secondary.label,
      ),
  )
}
