// Spaced repetition with FSRS, through ts-fsrs (SPEC-v2.md, "Scheduling: FSRS").
// v1's SM-2 schedule() is retired; v1 cards are converted once by migrateCard().
//
// One house rule on top of FSRS: reviews a day or more away are due at 04:00 on
// their day (the study day starts then), so a day's work is ready in the morning.
// Learning steps of minutes stay exact.

import { type Card as FsrsCard, createEmptyCard, type FSRS, fsrs, generatorParameters, type Grade as FsrsGrade, State } from 'ts-fsrs'
import type { Card, Grade, ReviewLog, Srs } from '../../types'

export const MIN = 60_000
export const DAY = 86_400_000
export const DAY_STARTS_AT_HOUR = 4 // like Anki: a late-night session still counts as "today"
export const DEFAULT_RETENTION = 0.9

const schedulers = new Map<number, FSRS>()

// One scheduler per desired retention (it can be set per locus).
export function scheduler(retention = DEFAULT_RETENTION): FSRS {
  let f = schedulers.get(retention)
  if (!f) {
    f = fsrs(generatorParameters({ request_retention: retention, maximum_interval: 365, enable_fuzz: true }))
    schedulers.set(retention, f)
  }
  return f
}

export function toSrs(card: FsrsCard): Srs {
  return {
    due: +card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as Srs['state'],
    ...(card.last_review != null && { last_review: +card.last_review }),
  }
}

// ts-fsrs takes millisecond timestamps wherever it takes dates.
function toInput(srs: Srs) {
  return { ...srs, last_review: srs.last_review ?? null }
}

export function newSrs(now: number): Srs {
  return toSrs(createEmptyCard(now))
}

export function isNewSrs(srs: Srs): boolean {
  return srs.state === State.New
}

// The four possible results of reviewing now, one per grade (Again, Hard, Good, Easy).
// The review screen shows their intervals on the buttons and saves the one picked,
// so what a button says is exactly what it does.
export function outcomes(srs: Srs, now: number, retention = DEFAULT_RETENTION): Record<Grade, Srs> {
  const preview = scheduler(retention).repeat(toInput(srs), now)
  const pick = (g: Grade) => snap(toSrs(preview[(g + 1) as FsrsGrade].card), now)
  return { 0: pick(0), 1: pick(1), 2: pick(2), 3: pick(3) }
}

export function review(srs: Srs, grade: Grade, now: number, retention = DEFAULT_RETENTION): Srs {
  return snap(toSrs(scheduler(retention).next(toInput(srs), now, (grade + 1) as FsrsGrade).card), now)
}

// Day-scale reviews are due at 04:00 on their day.
function snap(srs: Srs, now: number): Srs {
  return srs.scheduled_days >= 1 ? { ...srs, due: dueAfterDays(now, srs.scheduled_days) } : srs
}

// Chance (0..1) of remembering the card at `at`.
export function recall(srs: Srs, at: number, retention = DEFAULT_RETENTION): number {
  return scheduler(retention).get_retrievability(toInput(srs), at, false)
}

// What a grade button shows: the wait in days for reviews, minutes for learning steps.
export function waitLabel(after: Srs, now: number): string {
  return after.scheduled_days >= 1 ? formatWait(after.scheduled_days * DAY) : formatWait(after.due - now)
}

// ---------- From v1 (SM-2) ----------

// The FSRS state for a v1 card (SPEC-v2.md, "Migration of v1 cards"):
// - with review history: replay it in time order (v1 grades 0–3 are ratings 1–4);
// - reviewed but no history: Review state, stability ≈ its interval, mid difficulty, due unchanged;
// - never reviewed: a new card.
export function migrateCard(card: Card, logs: ReviewLog[], retention = DEFAULT_RETENTION): Srs {
  if (logs.length > 0) {
    let srs = newSrs(card.createdAt)
    for (const log of [...logs].sort((a, b) => a.at - b.at)) srs = review(srs, log.grade, log.at, retention)
    return srs
  }
  const reps = card.reps ?? 0
  if (reps === 0) return { ...newSrs(card.createdAt), lapses: card.lapses ?? 0 }
  const interval = Math.max(1, card.interval ?? 1)
  const due = card.due ?? card.createdAt
  return {
    due,
    stability: interval,
    difficulty: 5, // FSRS difficulty runs 1–10
    elapsed_days: interval,
    scheduled_days: interval,
    learning_steps: 0,
    reps,
    lapses: card.lapses ?? 0,
    state: State.Review,
    last_review: due - interval * DAY,
  }
}

// ---------- Days ----------

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

// A wait as shown on the grade buttons: "10m", "1d", "3.5mo".
export function formatWait(ms: number): string {
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))}m`
  if (ms < DAY) return `${Math.round(ms / (60 * MIN))}h`
  const days = ms / DAY
  if (days < 30) return `${Math.round(days)}d`
  if (days < 365) return `${trim(days / 30)}mo`
  return `${trim(days / 365)}y`
}

function trim(n: number): string {
  return n < 10 ? n.toFixed(1).replace(/\.0$/, '') : String(Math.round(n))
}
