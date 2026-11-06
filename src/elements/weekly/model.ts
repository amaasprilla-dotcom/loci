// Weekly targets (SPEC-v8-experimental.md, "Weekly targets"): each a range, a minimum
// (a full win) and a good-week number, counted Monday to Sunday on Loci's day (04:00 to
// 04:00). Monday starts a new week with the same targets. Pure functions, no storage.

import { studyDayStart } from '../flashcards/srs'

export interface WeeklyTarget {
  id: string
  name: string // "Videos", "Gym sessions"
  min: number // reaching it counts as a full win
  good: number // a good week
  unit?: string
  todoIds: string[] // blocks whose finished sessions count toward it on their own
}

// When the targets and rules may change.
export type ChangeRule =
  | { kind: 'wait'; hours: number } // any time, but only after a wait to think it over
  | { kind: 'reviewDay' } // only on review day
  | { kind: 'free' } // any time

export interface WeeklyRules {
  reviewDay: number // 0 = Sunday, as Date.getDay
  reviewAt: string | null // the review reminder, "18:00"
  reviewSteps: string[] // in your own words: "Count the week", "Pick next week's topic"
  changeRule: ChangeRule
}

export interface PendingChange {
  askedAt: number
  readyAt: number
  reason: string
  targets: WeeklyTarget[]
  rules: WeeklyRules
}

export interface WeeklyData extends WeeklyRules {
  targets: WeeklyTarget[]
  taps: Record<string, Record<string, number>> // week → target → +1s by hand
  weeks: Record<string, Record<string, { min: number; good: number }>> // the numbers each week was held to
  reviewed: string[] // weeks whose review is done
  pending: PendingChange | null
}

export const DEFAULT_RULES: WeeklyRules = {
  reviewDay: 0,
  reviewAt: '18:00',
  reviewSteps: ['Count the week', 'Plan next week', 'Change one thing only if something clearly failed'],
  changeRule: { kind: 'wait', hours: 24 },
}

export function defaultWeekly(): WeeklyData {
  return { ...DEFAULT_RULES, reviewSteps: [...DEFAULT_RULES.reviewSteps], targets: [], taps: {}, weeks: {}, reviewed: [], pending: null }
}

// Fills in anything missing (an element made by an older version, or half-synced).
export function weeklyOf(data: unknown): WeeklyData {
  const d = (data ?? {}) as Partial<WeeklyData>
  const base = defaultWeekly()
  return {
    ...base,
    ...d,
    targets: d.targets ?? [],
    taps: d.taps ?? {},
    weeks: d.weeks ?? {},
    reviewed: d.reviewed ?? [],
    pending: d.pending ?? null,
    reviewSteps: d.reviewSteps ?? base.reviewSteps,
    changeRule: d.changeRule ?? base.changeRule,
  }
}

export const rulesOf = (d: WeeklyRules): WeeklyRules => ({ reviewDay: d.reviewDay, reviewAt: d.reviewAt, reviewSteps: [...d.reviewSteps], changeRule: { ...d.changeRule } })

// ---------- Weeks ----------

// When the week holding `t` began: Monday 04:00.
export function weekStart(t: number): number {
  const d = new Date(studyDayStart(t))
  const back = (d.getDay() + 6) % 7 // days since Monday
  d.setDate(d.getDate() - back)
  return d.getTime()
}

export function weekEnd(t: number): number {
  const d = new Date(weekStart(t))
  d.setDate(d.getDate() + 7)
  return d.getTime()
}

// "2026-11-02": the Monday the week starts on.
export function weekKey(t: number): string {
  const d = new Date(weekStart(t))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The keys of the `n` weeks up to and including this one, oldest first.
export function lastWeeks(now: number, n: number): string[] {
  const start = new Date(weekStart(now))
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() - 7 * (n - 1 - i))
    return weekKey(d.getTime() + 3_600_000 * 12) // midday Monday: clear of the 04:00 edge
  })
}

// Loci's day of the week (0 = Sunday) at t: before 04:00 it's still yesterday.
export const dayOf = (t: number) => new Date(studyDayStart(t)).getDay()

// Whole days left in this week, today included: Monday 7, Sunday 1.
export const daysLeft = (t: number) => 7 - ((dayOf(t) + 6) % 7)

// ---------- Counting ----------

// Finished sessions of the target's blocks, by when they were done.
export interface DoneAt {
  todoId: string
  doneAt: number
}

export function countFor(data: WeeklyData, target: WeeklyTarget, week: string, done: DoneAt[]): number {
  const taps = data.taps[week]?.[target.id] ?? 0
  const linked = new Set(target.todoIds)
  const auto = done.filter((d) => linked.has(d.todoId) && weekKey(d.doneAt) === week).length
  return Math.max(0, taps + auto)
}

// What a week was held to: its snapshot, or the targets as they are now.
export function heldTo(data: WeeklyData, target: WeeklyTarget, week: string): { min: number; good: number } {
  return data.weeks[week]?.[target.id] ?? { min: target.min, good: target.good }
}

export type Status = 'short' | 'win' | 'good'

export function statusOf(count: number, held: { min: number; good: number }): Status {
  if (count >= held.good && held.good > 0) return 'good'
  if (count >= held.min) return 'win'
  return 'short'
}

// This week's numbers written down, so changing a target later doesn't rewrite what
// past weeks were held to. Returns true if anything was added.
export function snapshot(data: WeeklyData, week: string, overwrite = false): boolean {
  const current = data.weeks[week] ?? {}
  let changed = false
  for (const t of data.targets) {
    if (current[t.id] && !overwrite) continue
    if (current[t.id]?.min === t.min && current[t.id]?.good === t.good) continue
    current[t.id] = { min: t.min, good: t.good }
    changed = true
  }
  if (changed) data.weeks[week] = current
  return changed
}

// ---------- Changing the targets ----------

export type ChangeGate =
  | { kind: 'now' } // change straight away
  | { kind: 'wait'; hours: number } // ask, then confirm after the wait
  | { kind: 'closed'; opens: number } // only on review day: not today

export function changeGate(data: WeeklyData, now: number): ChangeGate {
  const rule = data.changeRule
  if (data.targets.length === 0 || rule.kind === 'free' || dayOf(now) === data.reviewDay) return { kind: 'now' }
  if (rule.kind === 'wait') return { kind: 'wait', hours: rule.hours }
  return { kind: 'closed', opens: nextDay(now, data.reviewDay) }
}

// The start (04:00) of the next day that is `day` of the week.
export function nextDay(now: number, day: number): number {
  const d = new Date(studyDayStart(now))
  do d.setDate(d.getDate() + 1)
  while (d.getDay() !== day)
  return d.getTime()
}

export const isReady = (p: PendingChange | null, now: number): boolean => p != null && now >= p.readyAt

// Applies a change: the new targets and rules, and this week held to the new numbers.
export function applyChange(data: WeeklyData, targets: WeeklyTarget[], rules: WeeklyRules, now: number): WeeklyData {
  const next: WeeklyData = { ...data, ...rulesOf(rules), targets: targets.map((t) => ({ ...t, todoIds: [...t.todoIds] })), weeks: { ...data.weeks }, pending: null }
  snapshot(next, weekKey(now), true)
  return next
}

// ---------- Review ----------

export const reviewDue = (data: WeeklyData, now: number): boolean => data.targets.length > 0 && dayOf(now) === data.reviewDay && !data.reviewed.includes(weekKey(now))
