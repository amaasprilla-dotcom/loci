// Reading and writing to-dos and their completions.

import { CONTENT_TABLES, db, deleteAttachmentsOf, deleteLinksFor, removeTodoContributors } from '../../store/db'
import type { ItemRef, Level, Todo, TodoCompletion, When } from '../../types'
import { fireGoalTriggers, goalsCountingTodo } from '../goals/store'
import { dueOf, resolveRepeat } from './when'

export interface TodoDraft {
  title: string
  why?: string
  importance: Level
  difficulty: Level
  when: When
}

// What an "after" or "goal" when waits for. Stored as an "after" link (SPEC-v2.md, "Links").
export type WaitsFor = { type: 'todo' | 'goal'; id: string } | null

const ref = (id: string): ItemRef => ({ type: 'todo', id })

export async function listTodos(elementId: string): Promise<Todo[]> {
  return db.todos.where('elementId').equals(elementId).toArray()
}

export async function createTodo(elementId: string, draft: TodoDraft, waitsFor: WaitsFor = null, id: string = crypto.randomUUID()): Promise<Todo> {
  const now = Date.now()
  const todo: Todo = { id, elementId, ...cleanDraft(draft), status: 'open', createdAt: now, updatedAt: now }
  await db.transaction('rw', db.todos, db.links, async () => {
    await db.todos.add(todo)
    await setWaitsFor(id, waitsFor)
  })
  // Waiting on a goal that's already far enough: fires straight away.
  if (waitsFor?.type === 'goal') await fireGoalTriggers(waitsFor.id)
  return (await db.todos.get(id))!
}

export async function updateTodo(id: string, draft: TodoDraft, waitsFor: WaitsFor = null): Promise<void> {
  await db.transaction('rw', db.todos, db.links, async () => {
    await db.todos.update(id, { ...cleanDraft(draft), updatedAt: Date.now() })
    await setWaitsFor(id, waitsFor)
  })
  if (waitsFor?.type === 'goal') await fireGoalTriggers(waitsFor.id)
}

function cleanDraft(d: TodoDraft): TodoDraft {
  return { title: d.title.trim(), ...(d.why?.trim() && { why: d.why.trim() }), importance: d.importance, difficulty: d.difficulty, when: d.when }
}

// The one "after" link pointing at this to-do: replaced, or removed for other whens.
async function setWaitsFor(todoId: string, waitsFor: WaitsFor) {
  const todo = await db.todos.get(todoId)
  await db.links.where('[to.type+to.id]').equals(['todo', todoId]).filter((l) => l.kind === 'after').delete()
  if (!waitsFor || !todo || (todo.when.kind !== 'after' && todo.when.kind !== 'goal')) return
  const now = Date.now()
  await db.links.add({ id: crypto.randomUUID(), from: waitsFor, to: ref(todoId), kind: 'after', createdAt: now, updatedAt: now })
  // Waiting on a to-do that's already done: nothing to wait for.
  if (waitsFor.type === 'todo' && (await db.todos.get(waitsFor.id))?.status === 'done') await fire(todoId, now)
}

export async function waitsForOf(todoId: string): Promise<WaitsFor> {
  const link = await db.links.where('[to.type+to.id]').equals(['todo', todoId]).filter((l) => l.kind === 'after').first()
  return link && (link.from.type === 'todo' || link.from.type === 'goal') ? { type: link.from.type, id: link.from.id } : null
}

// A waiting to-do whose trigger happened: due now, and dated from here on (SPEC-v2.md).
async function fire(todoId: string, now: number) {
  const todo = await db.todos.get(todoId)
  if (!todo || todo.status !== 'open' || (todo.when.kind !== 'after' && todo.when.kind !== 'goal')) return
  await db.todos.update(todoId, { when: { kind: 'at', at: now, hasTime: true }, updatedAt: now })
}

// To-dos waiting for this one to be done.
async function dependents(todoId: string): Promise<string[]> {
  const links = await db.links.where('[from.type+from.id]').equals(['todo', todoId]).filter((l) => l.kind === 'after').toArray()
  return links.map((l) => l.to.id)
}

const TABLES = () => [db.todos, db.todoCompletions, db.links, db.attachments, db.blobs]

// Done: a one-off to-do is finished; a repeating one logs this occurrence (older
// missed ones too) and moves to its next. Either way, to-dos waiting on it fire.
export async function completeTodo(id: string, now = Date.now()): Promise<void> {
  await db.transaction('rw', TABLES(), async () => {
    const todo = await db.todos.get(id)
    if (!todo || todo.status !== 'open') return
    if (todo.when.kind === 'repeat') {
      await applyRepeat(todo, resolveRepeat(todo.when, 'done', now), now)
    } else {
      await db.todoCompletions.add(completion(id, dueOf(todo.when, now) ?? now, 'done', now))
      await db.todos.update(id, { status: 'done', doneAt: now, updatedAt: now })
    }
    for (const waiting of await dependents(id)) await fire(waiting, now)
  })
  // It may have pushed a goal past a percentage another to-do waits for.
  for (const goal of await goalsCountingTodo(id)) await fireGoalTriggers(goal.id, now)
}

// Skip this occurrence of a repeating to-do.
export async function skipTodo(id: string, now = Date.now()): Promise<void> {
  await db.transaction('rw', TABLES(), async () => {
    const todo = await db.todos.get(id)
    if (!todo || todo.status !== 'open' || todo.when.kind !== 'repeat') return
    await applyRepeat(todo, resolveRepeat(todo.when, 'skipped', now), now)
  })
}

async function applyRepeat(todo: Todo, r: ReturnType<typeof resolveRepeat>, now: number) {
  if (todo.when.kind !== 'repeat') return
  await db.todoCompletions.bulkAdd(r.completions.map((c) => completion(todo.id, c.occurrenceAt, c.outcome, now)))
  if (r.next == null) await db.todos.update(todo.id, { status: 'done', doneAt: now, updatedAt: now }) // the rule has ended
  else await db.todos.update(todo.id, { when: { ...todo.when, next: r.next }, updatedAt: now })
}

function completion(todoId: string, occurrenceAt: number, outcome: TodoCompletion['outcome'], now: number): TodoCompletion {
  return { id: crypto.randomUUID(), todoId, occurrenceAt, outcome, ...(outcome === 'done' && { doneAt: now }), updatedAt: now }
}

// Undo a one-off Done.
export async function reopenTodo(id: string): Promise<void> {
  await db.todos.update(id, { status: 'open', doneAt: undefined, updatedAt: Date.now() })
}

export async function archiveTodo(id: string): Promise<void> {
  await db.todos.update(id, { status: 'archived', updatedAt: Date.now() })
}

// "When something happens" to-dos: the user says it happened, and it's due now.
export async function itHappened(id: string, now = Date.now()): Promise<void> {
  const todo = await db.todos.get(id)
  if (!todo || todo.when.kind !== 'when') return
  await db.todos.update(id, { when: { ...todo.when, firedAt: now }, updatedAt: now })
}

// How many to-dos wait on this one, for the delete confirmation.
export async function countDependents(id: string): Promise<number> {
  return (await dependents(id)).length
}

// Deletes the to-do with its history, attachments and links. To-dos that waited on
// it would wait forever, so they become due now.
export async function deleteTodo(id: string, now = Date.now()): Promise<void> {
  await db.transaction('rw', CONTENT_TABLES(), async () => {
    for (const waiting of await dependents(id)) await fire(waiting, now)
    await removeTodoContributors([id]) // it no longer counts toward any goal
    await deleteLinksFor([ref(id)])
    await deleteAttachmentsOf([{ type: 'todo', id }])
    await db.todoCompletions.where('todoId').equals(id).delete()
    await db.todos.delete(id)
  })
}

// Goals this to-do counts toward, for the delete prompt: deleting it removes those contributors.
export { goalsCountingTodo }
