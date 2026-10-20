// The To-do list element type (SPEC-v2.md, "To-dos"): plans written as a when plus
// an action, e.g. "Sunday 10:00 · Gather receipts".

import { h } from '../../dom'
import { formatNumber } from '../../locale'
import { go, subHash } from '../../router'
import { db } from '../../store/db'
import type { LocusElement, Todo } from '../../types'
import { iconNode } from '../flashcards/type'
import type { ElementType, Task } from '../registry'
import { completeTodo, itHappened } from './store'
import { dueOf, todoState, whenText } from './when'

const ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="5" height="5" rx="1.2"/><path d="M5 7.1l.9.9 1.6-1.7M12 7h8.5M3.5 15.5h5v5h-5zM12 18h8.5"/></svg>'

// What the waiting to-dos in this list wait for, by to-do id: the other item's title.
async function waitingTitles(todos: Todo[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  for (const t of todos) {
    if (t.when.kind !== 'after' && t.when.kind !== 'goal') continue
    const link = await db.links.where('[to.type+to.id]').equals(['todo', t.id]).filter((l) => l.kind === 'after').first()
    if (link?.from.type === 'todo') {
      const other = await db.todos.get(link.from.id)
      if (other) titles.set(t.id, other.title)
    }
  }
  return titles
}

export function todoTask(el: LocusElement, t: Todo, now: number, waitsFor?: string): Task {
  return {
    locusId: el.locusId,
    elementId: el.id,
    itemId: t.id,
    kind: 'todo',
    state: todoState(t, now),
    label: t.title,
    sublabel: whenText(t.when, now, waitsFor),
    importance: t.importance,
    difficulty: t.difficulty,
    dueAt: dueOf(t.when, now) ?? undefined,
    open: () => go(subHash(el, 'todo', t.id)),
    complete: () => completeTodo(t.id),
    ...(t.when.kind === 'when' && !t.when.firedAt && { secondary: { label: 'It happened', run: () => itHappened(t.id) } }),
  }
}

export const todosType: ElementType<Record<string, never>> = {
  type: 'todos',
  label: 'To-dos',
  noun: 'to-do list',
  description: 'Plans with a when: dated, repeating, or after something else',
  icon: ICON,

  createDefault: () => ({}),

  async renderCard(el, now) {
    const open = await db.todos.where('elementId').equals(el.id).filter((t) => t.status === 'open').toArray()
    const states = open.map((t) => todoState(t, now))
    const active = states.filter((s) => s === 'due' || s === 'overdue').length
    const overdue = states.filter((s) => s === 'overdue').length
    const planned = states.filter((s) => s === 'upcoming' || s === 'waiting').length
    return h(
      'div',
      { class: 'tile-content' },
      h('div', { class: 'tile-head' }, iconNode(ICON), h('span', { class: 'tile-kind' }, 'To-dos')),
      h('h3', { class: 'tile-title' }, el.title),
      h('p', { class: 'tile-meta' }, open.length === 0 ? 'Nothing open' : `${formatNumber(open.length)} open`),
      h(
        'div',
        { class: 'tile-status' },
        overdue > 0 && h('span', { class: 'pill pill-overdue' }, `${formatNumber(overdue)} overdue`),
        active - overdue > 0 && h('span', { class: 'pill pill-due' }, `${formatNumber(active - overdue)} now`),
        planned > 0 && h('span', { class: 'pill' }, `${formatNumber(planned)} planned`),
      ),
    )
  },

  async renderScreen(el, sub) {
    const { renderTodoList } = await import('./screens')
    return renderTodoList(el, sub[0] === 'todo' ? sub[1] : undefined)
  },

  async getTasks(el, now) {
    const open = await db.todos.where('elementId').equals(el.id).filter((t) => t.status === 'open').toArray()
    const titles = await waitingTitles(open)
    return open.map((t) => todoTask(el, t, now, titles.get(t.id)))
  },

  async nextDueAt(el, now) {
    const open = await db.todos.where('elementId').equals(el.id).filter((t) => t.status === 'open').toArray()
    const upcoming = open.map((t) => dueOf(t.when, now)).filter((d): d is number => d != null && d > now)
    return upcoming.length ? Math.min(...upcoming) : null
  },
}
