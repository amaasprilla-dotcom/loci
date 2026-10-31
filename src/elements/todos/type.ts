// The To-do list element type (SPEC-v2.md, "To-dos"): plans written as a when plus
// an action, e.g. "Sunday 10:00 · Gather receipts".

import { announceChange } from '../../changes'
import { h } from '../../dom'
import { formatNumber } from '../../locale'
import { go, subHash } from '../../router'
import { db } from '../../store/db'
import type { LocusElement, Todo } from '../../types'
import { iconNode } from '../flashcards/type'
import type { ElementType, Task } from '../registry'
import { completeTodo, itHappened, LOOSE } from './store'
import { dueOf, todoState, whenText } from './when'

const ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="5" height="5" rx="1.2"/><path d="M5 7.1l.9.9 1.6-1.7M12 7h8.5M3.5 15.5h5v5h-5zM12 18h8.5"/></svg>'

// What the waiting to-dos in this list wait for, by to-do id: the other item's title.
async function waitingTitles(todos: Todo[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  for (const t of todos) {
    if (t.when.kind !== 'after' && t.when.kind !== 'goal') continue
    const link = await db.links.where('[to.type+to.id]').equals(['todo', t.id]).filter((l) => l.kind === 'after').first()
    const other = link?.from.type === 'todo' ? await db.todos.get(link.from.id) : link?.from.type === 'goal' ? await db.goals.get(link.from.id) : undefined
    if (other) titles.set(t.id, other.title)
  }
  return titles
}

// A loose to-do (in no locus) opens its sheet in place, over whatever screen it's on.
export async function openLooseTodo(id: string) {
  const todo = await db.todos.get(id)
  if (!todo) return
  const { openTodoSheet } = await import('./screens')
  await openTodoSheet(todo)
  announceChange()
}

// el: the to-do's list; null for a loose to-do (locusId and elementId are then '').
export function todoTask(el: LocusElement | null, t: Todo, now: number, waitsFor?: string): Task {
  return {
    locusId: el?.locusId ?? LOOSE,
    elementId: el?.id ?? LOOSE,
    itemId: t.id,
    kind: 'todo',
    state: todoState(t, now),
    label: t.title,
    // "Start: open the doc · Sunday 10:00, at my desk": the first step leads, so starting is the easy part.
    sublabel: [t.plan?.firstStep && `Start: ${t.plan.firstStep}`, [whenText(t.when, now, waitsFor), t.plan?.cue].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
    importance: t.importance,
    difficulty: t.difficulty,
    dueAt: dueOf(t.when, now) ?? undefined,
    open: () => (el ? go(subHash(el, 'todo', t.id)) : void openLooseTodo(t.id)),
    complete: () => completeTodo(t.id),
    ...(t.when.kind === 'when' && !t.when.firedAt && { secondary: { label: 'It happened', run: () => itHappened(t.id) } }),
  }
}

// The open loose to-dos' tasks: they belong to no element, so allTasks asks for them apart.
export async function looseTodoTasks(now: number): Promise<Task[]> {
  const open = await db.todos.where('elementId').equals(LOOSE).filter((t) => t.status === 'open').toArray()
  const titles = await waitingTitles(open)
  return open.map((t) => todoTask(null, t, now, titles.get(t.id)))
}

// When the next loose to-do falls due, after now.
export async function looseNextDueAt(now: number): Promise<number | null> {
  const open = await db.todos.where('elementId').equals(LOOSE).filter((t) => t.status === 'open').toArray()
  const upcoming = open.map((t) => dueOf(t.when, now)).filter((d): d is number => d != null && d > now)
  return upcoming.length ? Math.min(...upcoming) : null
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
        active > 0 && h('span', { class: 'pill pill-due' }, `${formatNumber(active)} due`),
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
