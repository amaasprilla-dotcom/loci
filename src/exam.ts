// Exam mode: rules for decks that have an exam date.
//
// While the exam is ahead:
//  - no card is scheduled further out than max(1 day, 15% of the days left),
//  - new cards are introduced at an even pace, all of them by 3 days before the exam,
//  - in the final 2 days (and on exam day) every card comes up at least once.

import type { Schedule } from "./scheduler";

const DAY_MS = 24 * 60 * 60 * 1000;
const FINISH_NEW_CARDS_DAYS_BEFORE = 3;
const FINAL_DAYS = 2;

// Midnight at the start of the given day, in the user's time zone.
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Whole days from today until the exam: 0 = exam is today, 1 = tomorrow,
// negative = the exam has passed.
export function daysUntilExam(examDate: string, now: Date): number {
  const [year, month, day] = examDate.split("-").map(Number);
  const exam = new Date(year, month - 1, day);
  return Math.round((exam.getTime() - startOfDay(now).getTime()) / DAY_MS);
}

// The longest interval allowed, in days.
export function intervalCapDays(daysLeft: number): number {
  return Math.max(1, 0.15 * daysLeft);
}

// Pulls the next due date in if it would be later than the cap allows.
export function capSchedule(schedule: Schedule, daysLeft: number, now: Date): Schedule {
  const capDays = intervalCapDays(daysLeft);
  const latest = new Date(now.getTime() + capDays * DAY_MS);
  if (schedule.due <= latest) return schedule;
  return { ...schedule, due: latest, scheduled_days: Math.round(capDays) };
}

// How many new cards may be introduced today so that all of them are
// introduced by 3 days before the exam.
//   newLeft: new cards not yet seen; introducedToday: new cards already seen today.
export function newCardsAllowedToday(
  newLeft: number,
  introducedToday: number,
  daysLeft: number,
): number {
  const daysToSpreadOver = daysLeft - FINISH_NEW_CARDS_DAYS_BEFORE + 1; // including today
  if (daysToSpreadOver <= 1) return newLeft; // deadline is today or past: all of them
  const perDay = Math.ceil((newLeft + introducedToday) / daysToSpreadOver);
  return Math.max(0, perDay - introducedToday);
}

// In the final days, a card must come up if it hasn't been reviewed since they began.
export function isFinalDays(daysLeft: number): boolean {
  return daysLeft >= 0 && daysLeft <= FINAL_DAYS;
}

export function finalDaysStart(examDate: string): Date {
  const [year, month, day] = examDate.split("-").map(Number);
  return new Date(year, month - 1, day - FINAL_DAYS);
}
