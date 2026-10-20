// Reading and writing goals, their contributors and check-ins.

import { CONTENT_TABLES, db, deleteAttachmentsOf, deleteGoalContents, deleteLinksFor, wakeDependents } from '../../store/db'
import type { ChecklistItem, Contributor, Goal, GoalEntry, Todo, TodoCompletion } from '../../types'
import { nextOccurrence } from '../todos/when'
import { defaultCheckin } from './defaults'
import { type GoalData, goalProgress } from './progress'

// A contributor as the editor makes it. A to-do count names its to-do; the
// contributes link is made on save.
type Base = 'id' | 'goalId' | 'order' | 'createdAt' | 'updatedAt'
export type ContributorDraft =
  | (Omit<Extract<Contributor, { kind: 'todoCount' }>, Base | 'linkId'> & { todoId: string })
  | Omit<Extract<Contributor, { kind: 'number' }>, Base>
  | Omit<Extract<Contributor, { kind: 'slider' }>, Base>
  | Omit<Extract<Contributor, { kind: 'checklist' }>, Base>

export interface GoalDraft {
  title: string
  why?: string
  deadline?: number
}

export async function listGoals(elementId: string): Promise<Goal[]> {
  const goals = await db.goals.where('elementId').equals(elementId).toArray()
  return goals.sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity) || a.createdAt - b.createdAt)
}

export async function listContributors(goalId: string): Promise<Contributor[]> {
  const list = await db.goalContributors.where('goalId').equals(goalId).toArray()
  return list.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
}

// Everything the progress functions need, for one goal.
export async function loadGoalData(goal: Goal): Promise<GoalData> {
  const contributors = await listContributors(goal.id)
  const entries = await db.goalEntries.where('contributorId').anyOf(contributors.map((c) => c.id)).toArray()
  const todos = new Map<string, Todo>()
  const completions = new Map<string, TodoCompletion[]>()
  for (const c of contributors) {
    if (c.kind !== 'todoCount') continue
    const link = await db.links.get(c.linkId)
    const todo = link && (await db.todos.get(link.from.id))
    if (!todo) continue
    todos.set(c.linkId, todo)
    completions.set(todo.id, await db.todoCompletions.where('todoId').equals(todo.id).toArray())
  }
  return { goal, contributors, entries, todos, completions }
}

export async function progressOf(goalId: string, at = Date.now()): Promise<number> {
  const goal = await db.goals.get(goalId)
  return goal ? goalProgress(await loadGoalData(goal), at) : 0
}

// ---------- Goals ----------

// A new goal with its contributors; with none, the default weekly check-in.
export async function createGoal(elementId: string, draft: GoalDraft, contributors: ContributorDraft[] = [], id: string = crypto.randomUUID()): Promise<Goal> {
  const now = Date.now()
  const goal: Goal = {
    id,
    elementId,
    title: draft.title.trim(),
    ...(draft.why?.trim() && { why: draft.why.trim() }),
    ...(draft.deadline != null && { deadline: draft.deadline }),
    startAt: now,
    status: 'open',
    notifyCheckins: false,
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', [db.goals, db.goalContributors, db.links], async () => {
    await db.goals.add(goal)
    if (contributors.length === 0) await db.goalContributors.add(defaultCheckin(id, now))
    for (const [i, c] of contributors.entries()) await insertContributor(id, c, i, now)
  })
  return goal
}

export async function updateGoal(id: string, patch: Partial<Pick<Goal, 'title' | 'why' | 'deadline' | 'notifyCheckins' | 'status'>>): Promise<void> {
  await db.goals.update(id, { ...patch, updatedAt: Date.now() })
}

// Deletes the goal with its contributors, check-ins, attachments and links. To-dos
// that waited for it to reach a percentage become due now.
export async function deleteGoal(id: string): Promise<void> {
  await db.transaction('rw', CONTENT_TABLES(), async () => {
    await wakeDependents([{ type: 'goal', id }])
    await deleteGoalContents([id])
    await deleteLinksFor([{ type: 'goal', id }])
    await deleteAttachmentsOf([{ type: 'goal', id }])
    await db.goals.delete(id)
  })
}

// ---------- Contributors ----------

async function insertContributor(goalId: string, draft: ContributorDraft, order: number, now: number): Promise<Contributor> {
  let c: Contributor
  if (draft.kind === 'todoCount') {
    const { todoId, ...rest } = draft
    const link = { id: crypto.randomUUID(), from: { type: 'todo' as const, id: todoId }, to: { type: 'goal' as const, id: goalId }, kind: 'contributes' as const, createdAt: now, updatedAt: now }
    await db.links.add(link)
    c = { ...rest, id: crypto.randomUUID(), goalId, linkId: link.id, order, createdAt: now, updatedAt: now }
  } else {
    c = { ...draft, id: crypto.randomUUID(), goalId, order, createdAt: now, updatedAt: now } as Contributor
  }
  await db.goalContributors.add(c)
  return c
}

export async function addContributor(goalId: string, draft: ContributorDraft): Promise<Contributor> {
  const now = Date.now()
  const c = await db.transaction('rw', [db.goalContributors, db.links], async () => {
    const order = (await db.goalContributors.where('goalId').equals(goalId).count()) + 1
    return insertContributor(goalId, draft, order, now)
  })
  await fireGoalTriggers(goalId)
  return c
}

// Edits a contributor's own fields (not which to-do a count follows).
export async function updateContributor(id: string, patch: Partial<Contributor>): Promise<void> {
  const c = await db.goalContributors.get(id)
  if (!c) return
  await db.goalContributors.put({ ...c, ...patch, id, goalId: c.goalId, kind: c.kind, updatedAt: Date.now() } as Contributor)
  await fireGoalTriggers(c.goalId)
}

// Removes a contributor; a goal never ends up with none (the default check-in comes back).
export async function removeContributor(id: string): Promise<void> {
  const c = await db.goalContributors.get(id)
  if (!c) return
  await db.transaction('rw', [db.goalContributors, db.goalEntries, db.links], async () => {
    await db.goalEntries.where('contributorId').equals(id).delete()
    await db.goalContributors.delete(id)
    if (c.kind === 'todoCount') await db.links.delete(c.linkId)
    if ((await db.goalContributors.where('goalId').equals(c.goalId).count()) === 0) await db.goalContributors.add(defaultCheckin(c.goalId, Date.now()))
  })
  await fireGoalTriggers(c.goalId)
}

// ---------- Check-ins ----------

export const isCheckin = (c: Contributor): c is Extract<Contributor, { kind: 'number' | 'slider' }> => c.kind === 'number' || c.kind === 'slider'

// Check-ins whose time has come. A missed one simply stays due (never overdue).
export function dueCheckins(contributors: Contributor[], now: number) {
  return contributors.filter(isCheckin).filter((c) => c.schedule.next <= now)
}

// Saves check-in answers; each answered check-in moves on to its next time.
export async function saveCheckin(answers: { contributorId: string; value: number }[], now = Date.now()): Promise<void> {
  const goalIds = new Set<string>()
  await db.transaction('rw', db.goalContributors, db.goalEntries, async () => {
    for (const a of answers) {
      const c = await db.goalContributors.get(a.contributorId)
      if (!c || !isCheckin(c)) continue
      const entry: GoalEntry = { id: crypto.randomUUID(), contributorId: c.id, at: now, value: a.value, updatedAt: now }
      await db.goalEntries.add(entry)
      const next = c.schedule.next <= now ? nextOccurrence(c.schedule, now) : c.schedule.next
      await db.goalContributors.put({ ...c, schedule: { ...c.schedule, next: next ?? c.schedule.next }, updatedAt: now } as Contributor)
      goalIds.add(c.goalId)
    }
  })
  for (const id of goalIds) await fireGoalTriggers(id, now)
}

export async function toggleChecklistItem(contributorId: string, itemId: string, now = Date.now()): Promise<void> {
  const c = await db.goalContributors.get(contributorId)
  if (!c || c.kind !== 'checklist') return
  const items: ChecklistItem[] = c.items.map((i) => (i.id === itemId ? (i.doneAt ? { id: i.id, text: i.text } : { ...i, doneAt: now }) : i))
  await db.goalContributors.put({ ...c, items, updatedAt: now } as Contributor)
  await fireGoalTriggers(c.goalId, now)
}

// ---------- Triggers ----------

// To-dos waiting for this goal to reach a percentage (SPEC-v2.md, "When a goal
// reaches…") fire once it has: due now, dated from then on.
export async function fireGoalTriggers(goalId: string, now = Date.now()): Promise<void> {
  const percent = (await progressOf(goalId, now)) * 100
  const links = await db.links.where('[from.type+from.id]').equals(['goal', goalId]).filter((l) => l.kind === 'after').toArray()
  for (const l of links) {
    const t = await db.todos.get(l.to.id)
    if (t?.status === 'open' && t.when.kind === 'goal' && percent >= t.when.percent - 1e-9) {
      await db.todos.update(t.id, { when: { kind: 'at', at: now, hasTime: true }, updatedAt: now })
    }
  }
}

// Goals a to-do counts toward, e.g. to re-check their triggers after it's done.
export async function goalsCountingTodo(todoId: string): Promise<Goal[]> {
  const links = await db.links.where('[from.type+from.id]').equals(['todo', todoId]).filter((l) => l.kind === 'contributes').toArray()
  return (await db.goals.bulkGet(links.map((l) => l.to.id))).filter((g): g is Goal => g != null)
}
