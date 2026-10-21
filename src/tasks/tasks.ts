// Every task from every element in every locus (SPEC-v2.md, "Task model v2").
// Never stored: worked out from the elements each time, so it's always current.
// One result drives the Tasks screen, the home badge and which bubbles pulse.

import { isActive, registry, type Task } from '../elements/registry'
import { db } from '../store/db'
import { mergeStudyTasks, splitStudyTasks } from '../study/tasks'
import { examTasks } from '../exams/tasks'

// How much one step of importance outweighs difficulty (SPEC-v2.md, "Ordering").
// With 3, one step of importance beats up to two steps of difficulty.
export const W_IMPORTANCE = 3

export const score = (t: Task): number => W_IMPORTANCE * t.importance - t.difficulty

// Active tasks: highest score first; ties go to the overdue one, then the earlier one.
export function compareActive(a: Task, b: Task): number {
  return score(b) - score(a) || overdueFirst(a, b) || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)
}

// Inactive tasks: soonest first, someday last.
export function compareInactive(a: Task, b: Task): number {
  return Number(a.state === 'someday') - Number(b.state === 'someday') || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)
}

const overdueFirst = (a: Task, b: Task) => Number(b.state === 'overdue') - Number(a.state === 'overdue')

export type Section = 'now' | 'goals' | 'planned' | 'someday'

// Where a task goes on the Tasks screen (and in the locus view). Goals and exams always
// go to "Goals and exams", whatever their state; finished items ("info") aren't listed.
export function sectionOf(t: Task): Section | null {
  if (t.kind === 'goal' || t.kind === 'exam') return 'goals'
  if (isActive(t)) return 'now'
  if (t.state === 'someday') return 'someday'
  if (t.state === 'upcoming' || t.state === 'waiting') return 'planned'
  return null
}

export function sections(tasks: Task[]): Record<Section, Task[]> {
  const out: Record<Section, Task[]> = { now: [], goals: [], planned: [], someday: [] }
  for (const t of tasks) {
    const s = sectionOf(t)
    if (s) out[s].push(t)
  }
  out.now.sort(compareActive)
  out.goals.sort(compareInactive)
  out.planned.sort(compareInactive)
  out.someday.sort(compareInactive)
  return out
}

export async function allTasks(now = Date.now()): Promise<Task[]> {
  const elements = await db.elements.toArray()
  const lists = await Promise.all(
    // A type this version doesn't know (e.g. from a newer backup) has no tasks.
    elements.map((el) => registry.get(el.type)?.getTasks(el, now) ?? Promise.resolve([])),
  )
  // Decks and sets study as one task per locus, unless set otherwise.
  const tasks = (await splitStudyTasks()) ? lists.flat() : mergeStudyTasks(lists.flat())
  return [...tasks, ...(await examTasks(now))]
}

// The element whose work falls due soonest after now, for the empty "Now" section.
// `locusIds` limits it to some loci (the tag filter).
export async function nextUpcoming(now: number, locusIds?: Set<string>): Promise<{ elementId: string; title: string; at: number } | null> {
  const elements = (await db.elements.toArray()).filter((el) => !locusIds || locusIds.has(el.locusId))
  let best: { elementId: string; title: string; at: number } | null = null
  for (const el of elements) {
    const at = await registry.get(el.type)?.nextDueAt?.(el, now)
    if (at != null && (best == null || at < best.at)) best = { elementId: el.id, title: el.title, at }
  }
  return best
}
