// Works out the priority terms for each active task and ranks them
// (SPEC-v5-now.md, "Priority score"). Candidates are the active to-dos and repeats,
// goal check-ins and one study task per bubble; planned and someday items don't compete.

import { daysLeft } from '../exams/exams'
import { isNewSrs } from '../elements/flashcards/srs'
import { goalsCountingTodo, loadGoalData } from '../elements/goals/store'
import { behindPace, goalProgress } from '../elements/goals/progress'
import { isActive, type Task } from '../elements/registry'
import { dayStartOf, dueOf, nextRollover, occurrencesBetween } from '../elements/todos/when'
import { db } from '../store/db'
import { mergeStudyTasks } from '../study/tasks'
import type { Goal } from '../types'
import { passedOver } from './events'
import {
  B_EXAM_WINDOW_DAYS,
  type CandidateType,
  compareRanked,
  examPace,
  goalPace,
  intervalWord,
  missedTerm,
  PASSED_OVER_MS,
  priority,
  type Ranked,
  type Terms,
  urgencyDated,
  urgencyStudy,
  whyLine,
  type WhyContext,
} from './priority'

const HOUR = 3_600_000
const DAY = 86_400_000

const isCandidate = (t: Task) => isActive(t) && (t.kind === 'todo' || t.kind === 'checkin' || t.kind === 'review')

// One stable id per candidate: the same across refreshes, one per bubble for merged study.
export function taskKey(t: Task): string {
  if (t.kind === 'review') return t.elementId ? `review:${t.elementId}` : `study:${t.locusId}`
  return `${t.kind}:${t.itemId ?? t.locusId}`
}

// 04:00 days between the due moment and now, at least 1: "3 days late".
export function daysLate(dueAt: number, now: number): number {
  return Math.max(1, Math.round((dayStartOf(now) - dayStartOf(dueAt)) / DAY))
}

export async function rankTasks(tasks: Task[], now: number): Promise<Task[]> {
  const candidates = tasks.filter(isCandidate)
  if (candidates.length === 0) return tasks

  const todos = new Map((await db.todos.bulkGet(candidates.filter((t) => t.kind === 'todo').map((t) => t.itemId!))).filter((t) => t != null).map((t) => [t.id, t]))
  const passed = await passedOver(now, PASSED_OVER_MS)
  const exams = tasks.filter((t) => t.kind === 'exam' && t.dueAt != null)

  const goals = new Map<string, { title: string; behind: number } | null>()
  async function behindOf(goal: Goal | undefined) {
    if (!goal || goal.status !== 'open') return null
    if (!goals.has(goal.id)) {
      const behind = behindPace(goal, goalProgress(await loadGoalData(goal), now), now)
      goals.set(goal.id, behind == null ? null : { title: goal.title, behind })
    }
    return goals.get(goal.id)!
  }

  const ranked = new Map<Task, Ranked>()
  for (const t of candidates) {
    const key = taskKey(t)
    let type: CandidateType = 'todo'
    let U = 0
    let B = 0
    let N = 0
    const ctx: WhyContext = { importance: t.importance }

    if (t.kind === 'review') {
      type = 'study'
      const due = t.study ? t.study.cards + t.study.problems + (t.study.notes ?? 0) : 0
      U = urgencyStudy(due)
      ctx.studyDue = due
      for (const e of exams) {
        const days = daysLeft({ date: e.dueAt! }, now)
        if (e.locusId !== t.locusId || days > B_EXAM_WINDOW_DAYS) continue
        const readiness = e.progress ?? 0
        if (examPace(readiness) > B) {
          B = examPace(readiness)
          ctx.exam = { days, readiness }
        }
      }
    } else if (t.kind === 'checkin') {
      type = 'checkin'
      const g = await behindOf(await db.goals.get(t.itemId!))
      if (g) {
        B = goalPace(g.behind)
        ctx.goal = g
      }
    } else {
      const todo = todos.get(t.itemId!)
      const due = todo ? dueOf(todo.when, now) : null
      if (due != null) {
        const overdueAt = nextRollover(due)
        if (now > overdueAt) {
          U = urgencyDated((now - overdueAt) / HOUR)
          ctx.daysLate = daysLate(due, now)
        }
      }
      if (todo?.when.kind === 'repeat') {
        type = 'repeat'
        // The latest passed occurrence is the one on the card; the older ones were missed.
        const missed = todo.when.next <= now ? Math.max(0, occurrencesBetween(todo.when, todo.when.next, now).length - 1) : 0
        N = missedTerm(missed)
        if (missed > 0) {
          const done = await db.todoCompletions.where('todoId').equals(todo.id).filter((c) => c.outcome === 'done').toArray()
          const last = Math.max(0, ...done.map((c) => c.doneAt ?? c.occurrenceAt))
          ctx.repeat = { interval: intervalWord(todo.when.rrule), ...(last > 0 && { lastDone: last }) }
        }
      }
      if (todo) {
        for (const goal of await goalsCountingTodo(todo.id)) {
          const g = await behindOf(goal)
          if (g && goalPace(g.behind) > B) {
            B = goalPace(g.behind)
            ctx.goal = g
          }
        }
      }
    }

    const terms: Terms = { I: t.importance, U, B, N, S: passed.has(key) ? 1 : 0 }
    ranked.set(t, { key, type, priority: priority(terms), terms, why: whyLine(terms, ctx) })
  }
  return tasks.map((t) => (ranked.has(t) ? { ...t, rank: ranked.get(t) } : t))
}

// The Now card's candidates, best first. Study is one per bubble even when decks and
// sets are split into their own tasks.
export async function nowCandidates(tasks: Task[], now: number): Promise<Task[]> {
  const split = tasks.some((t) => t.kind === 'review' && t.elementId !== '')
  const list = split ? await rankTasks(mergeStudyTasks(tasks), now) : tasks
  return list.filter((t) => t.rank && isActive(t)).sort(compareRanked)
}

// For "Nothing due": the bubble with the most cards or problems never studied.
export async function bubbleWithNewCards(): Promise<string | null> {
  const elements = (await db.elements.toArray()).filter((e) => e.type === 'flashcards' || e.type === 'problems')
  const locusOf = new Map(elements.map((e) => [e.id, e.locusId]))
  const ids = [...locusOf.keys()]
  const counts = new Map<string, number>()
  const add = (elementId: string) => counts.set(locusOf.get(elementId)!, (counts.get(locusOf.get(elementId)!) ?? 0) + 1)
  for (const c of await db.cards.where('elementId').anyOf(ids).toArray()) if (isNewSrs(c.srs)) add(c.elementId)
  for (const p of await db.problemTemplates.where('elementId').anyOf(ids).toArray()) if (!p.tooTight && isNewSrs(p.srs)) add(p.elementId)
  let best: string | null = null
  for (const [locusId, n] of counts) if (n > (counts.get(best ?? '') ?? 0)) best = locusId
  return best
}
