// Spaced repetition: SM-2 with Anki-style grades (SPEC.md, "Scheduling algorithm").
// Deterministic math, no external service. ts-fsrs can replace schedule() later
// without UI changes.

import type { Card, Grade } from '../../types'

export const MIN = 60_000
export const DAY = 86_400_000
export const DAY_STARTS_AT_HOUR = 4 // like Anki: a late-night session still counts as "today"
export const AGAIN_DELAY = 10 * MIN

// `fuzz` is a number in [0, 1) that spreads intervals by ±5% so cards added
// together don't stay bunched up. The review screen picks it once per card, so
// the intervals shown on the buttons are exactly what grading gives.
export function schedule(card: Card, grade: Grade, now = Date.now(), fuzz = Math.random()): Card {
  const c = { ...card, updatedAt: now }
  if (grade === 0) {
    // Forgot: back to the start, shown again in 10 minutes.
    c.lapses += 1
    c.reps = 0
    c.interval = 0
    c.ease = Math.max(1.3, c.ease - 0.2)
    c.due = now + AGAIN_DELAY
    return c
  }
  c.reps += 1
  if (c.reps === 1) c.interval = grade === 3 ? 4 : 1
  else if (c.reps === 2) c.interval = grade === 1 ? 3 : grade === 3 ? 8 : 6
  else {
    const mult = grade === 1 ? 1.2 : grade === 3 ? c.ease * 1.3 : c.ease
    c.interval = Math.max(c.interval + 1, Math.round(c.interval * mult))
  }
  c.ease = Math.max(1.3, c.ease + [0, -0.15, 0, 0.15][grade])
  c.interval = Math.round(c.interval * (0.95 + fuzz * 0.1)) || 1
  c.due = dueAfterDays(now, c.interval)
  return c
}

// 04:00 local time, `days` calendar days after `now`'s date. Done with dates
// rather than adding 24h steps, so daylight-saving changes don't shift it to 03:00 or 05:00.
export function dueAfterDays(now: number, days: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  d.setHours(DAY_STARTS_AT_HOUR)
  return d.getTime()
}

// When the current study day began: today 04:00, or yesterday 04:00 before 4am.
export function studyDayStart(now: number): number {
  const d = new Date(now)
  if (d.getHours() < DAY_STARTS_AT_HOUR) d.setDate(d.getDate() - 1)
  d.setHours(DAY_STARTS_AT_HOUR, 0, 0, 0)
  return d.getTime()
}

// The wait each grade would give, as shown on the grade buttons: "10m", "1d", "3.5mo".
export function formatWait(ms: number): string {
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))}m`
  if (ms < DAY) return `${Math.round(ms / (60 * MIN))}h`
  const days = ms / DAY
  if (days < 30) return `${Math.round(days)}d`
  if (days < 365) return `${trim(days / 30)}mo`
  return `${trim(days / 365)}y`
}

// Shown intervals for review cards are in whole days; for Again, the 10 minutes.
export function gradeLabel(card: Card, grade: Grade, now: number, fuzz: number): string {
  const next = schedule(card, grade, now, fuzz)
  return grade === 0 ? formatWait(next.due - now) : formatWait(next.interval * DAY)
}

function trim(n: number): string {
  return n < 10 ? n.toFixed(1).replace(/\.0$/, '') : String(Math.round(n))
}
