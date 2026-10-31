// The priority score (SPEC-v5-now.md, "Priority score"): one number per candidate.
// Pure: no database, no DOM. Importance dominates; time, goal and exam pace and
// missed repeats adjust it; being passed over lowers it. Difficulty is not in it.

import type { Task } from '../elements/registry'
import { levelName } from '../levels'
import type { Level } from '../types'

// All of these are invented starting values (tune them against the event log).
export const W = { I: 3, U: 4, B: 2, N: 1.5, S: 3 } as const
export const U_SATURATION_HOURS = 168 // a dated item is fully urgent a week after it turned overdue
export const U_SATURATION_DUE = 100 // a study candidate with this many due is fully urgent
export const B_SATURATION_BEHIND = 20 // percentage points behind pace
export const B_EXAM_WINDOW_DAYS = 14 // exams count once they're this near
export const EXAM_TARGET = 0.9 // readiness target, the same as the exam default
export const EXAM_SATURATION = 0.2 // readiness this far under the target is fully behind
export const ON_PACE_BEHIND = 2 // as many points behind still reads "On pace"
export const N_SATURATION = 3 // missed occurrences
export const PASSED_OVER_MS = 24 * 3_600_000

export interface Terms {
  I: number
  U: number
  B: number
  N: number
  S: number
}

export type CandidateType = 'study' | 'todo' | 'repeat' | 'checkin'

// What the ranking worked out for one task.
export interface Ranked {
  key: string
  type: CandidateType
  priority: number
  terms: Terms
  why: string
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export const priority = (t: Terms): number => W.I * t.I + W.U * t.U + W.B * t.B + W.N * t.N - W.S * t.S

export const urgencyDated = (hoursOverdue: number): number => clamp01(hoursOverdue / U_SATURATION_HOURS)
export const urgencyStudy = (due: number): number => clamp01(due / U_SATURATION_DUE)
// `behind` in percentage points; on pace or ahead counts nothing.
export const goalPace = (behind: number): number => (behind <= ON_PACE_BEHIND ? 0 : clamp01(behind / B_SATURATION_BEHIND))
export const examPace = (readiness: number): number => clamp01((EXAM_TARGET - readiness) / EXAM_SATURATION)
export const missedTerm = (missed: number): number => clamp01(missed / N_SATURATION)

// ---------- Order ----------

// Highest score first; ties go to the overdue one, then the earlier one, then the key
// (so the order doesn't flip between refreshes).
export function compareRanked(a: Task, b: Task): number {
  return (
    (b.rank?.priority ?? W.I * b.importance) - (a.rank?.priority ?? W.I * a.importance) ||
    Number(b.state === 'overdue') - Number(a.state === 'overdue') ||
    (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) ||
    (a.rank?.key ?? '').localeCompare(b.rank?.key ?? '')
  )
}

// ---------- Why-line ----------

export interface WhyContext {
  importance: Level
  // Where B came from (one of them).
  exam?: { days: number; readiness: number }
  goal?: { title: string; behind: number }
  // Where U came from: a dated item, days late; or a study candidate, how many due.
  daysLate?: number
  studyDue?: number
  // Where N came from.
  repeat?: { interval: string; lastDone?: number }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// "Weekly", "Every 2 weeks": the repeat rule in a word.
export function intervalWord(rrule: string): string {
  const freq = /FREQ=(\w+)/.exec(rrule)?.[1]
  const n = Number(/INTERVAL=(\d+)/.exec(rrule)?.[1] ?? 1)
  const word = { DAILY: ['Daily', 'day'], WEEKLY: ['Weekly', 'week'], MONTHLY: ['Monthly', 'month'], YEARLY: ['Yearly', 'year'] }[freq ?? '']
  if (!word) return 'Repeats'
  return n > 1 ? `Every ${n} ${word[1]}s` : word[0]
}

// Built from the largest weighted term other than I; the importance label when they're all 0.
// Factual, never an alarm.
export function whyLine(terms: Terms, ctx: WhyContext): string {
  // Order matters on a tie: pace, then urgency, then missed repeats.
  const candidates = [
    { term: 'B', weight: W.B * terms.B },
    { term: 'U', weight: W.U * terms.U },
    { term: 'N', weight: W.N * terms.N },
  ]
  let best = candidates[0]
  for (const c of candidates) if (c.weight > best.weight) best = c
  if (best.weight <= 0) return levelName('importance', ctx.importance)
  if (best.term === 'B') {
    // The caller gives only the source that set B.
    if (ctx.exam) return `Exam in ${plural(ctx.exam.days, 'day', 'days')} · readiness ${Math.round(ctx.exam.readiness * 100)}%`
    if (ctx.goal) return `Moves "${ctx.goal.title}" · ${ctx.goal.behind}% behind pace`
  }
  if (best.term === 'U') {
    if (ctx.studyDue != null) return `${ctx.studyDue} due`
    if (ctx.daysLate != null) return `${plural(ctx.daysLate, 'day', 'days')} late`
  }
  if (best.term === 'N' && ctx.repeat) {
    const last = ctx.repeat.lastDone
    return `${ctx.repeat.interval} · ${last != null ? `last done ${new Date(last).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'not done yet'}`
  }
  return levelName('importance', ctx.importance)
}
