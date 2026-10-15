// The numbers behind the Progress screen. Everything is worked out from the
// review log and the card schedules, so the charts always match the log.

import { startOfDay } from "./exam";
import { studyMs } from "./goal";
import { State } from "./scheduler";
import type { AppData } from "./storage";
import { dayKey } from "./storage";
import type { ReviewLogEntry } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const SOLID_STABILITY_DAYS = 21;

// A review that was actually answered (skips don't count).
function answered(entry: ReviewLogEntry): boolean {
  return entry.result !== "skipped";
}

// Did the user remember? Checked answers: right or wrong. Self-graded cards:
// anything but "Again" counts as remembered (the usual spaced-repetition rule).
function remembered(entry: ReviewLogEntry): boolean {
  if (entry.result === "correct") return true;
  if (entry.result === "wrong") return false;
  return (entry.grade ?? 1) >= 2;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// Monday of the week the date is in.
function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  const sinceMonday = (day.getDay() + 6) % 7; // getDay(): 0 = Sunday
  return addDays(day, -sinceMonday);
}

// ---------- 1. Study calendar ----------

export type CalendarDay = { date: Date; key: string; reviews: number; future: boolean };

// Reviews per day for the last `weeks` weeks, as weeks (columns) of 7 days, Monday first.
export function studyCalendar(log: ReviewLogEntry[], now: Date, weeks = 17): CalendarDay[][] {
  const counts = new Map<string, number>();
  for (const entry of log) {
    if (!answered(entry)) continue;
    const key = dayKey(new Date(entry.at));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const today = startOfDay(now);
  const firstMonday = addDays(startOfWeek(today), -(weeks - 1) * 7);
  return Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const date = addDays(firstMonday, week * 7 + weekday);
      const key = dayKey(date);
      return { date, key, reviews: counts.get(key) ?? 0, future: date > today };
    }),
  );
}

// ---------- 2. Retention ----------

export type Retention = {
  rate: number | null; // 0-1, null if there were no reviews
  reviews: number;
  remembered: number;
  previousRate: number | null; // the 30 days before that, for the trend arrow
};

// Share of reviews (not first-time cards, not extra practice) remembered, last `days` days.
export function retention(log: ReviewLogEntry[], now: Date, days = 30): Retention {
  const end = now.getTime();
  const start = end - days * DAY_MS;
  const previousStart = start - days * DAY_MS;

  function rateBetween(from: number, to: number) {
    const reviews = log.filter((entry) => {
      const time = new Date(entry.at).getTime();
      return time >= from && time < to && answered(entry) && !entry.practice && entry.stateBefore !== "new";
    });
    const kept = reviews.filter(remembered).length;
    return { reviews: reviews.length, remembered: kept, rate: reviews.length ? kept / reviews.length : null };
  }

  const current = rateBetween(start, end + 1);
  const previous = rateBetween(previousStart, start);
  return { ...current, previousRate: previous.rate };
}

// ---------- 3. Upcoming ----------

export type UpcomingDay = { date: Date; label: string; cards: number; exams: string[] };

// Cards coming up on each of the next 7 days. Today's count (`dueToday`) comes
// from the app, because it includes overdue cards and new cards to introduce;
// later days count cards already studied whose due date falls on that day.
export function upcoming(data: AppData, now: Date, dueToday: number): UpcomingDay[] {
  const decks = data.decks.filter((deck) => !deck.archived);
  const today = startOfDay(now);

  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i);
    const next = addDays(today, i + 1);
    const cards =
      i === 0
        ? dueToday
        : decks
            .flatMap((deck) => deck.cardIds)
            .map((id) => data.schedules[id])
            .filter((s) => s && s.state !== State.New && s.due >= date && s.due < next).length;
    const label = i === 0 ? "Today" : date.toLocaleDateString(undefined, { weekday: "short" });
    const exams = decks.filter((deck) => deck.examDate === dayKey(date)).map((deck) => deck.name);
    return { date, label, cards, exams };
  });
}

// ---------- 4. Mastery per deck ----------

export type DeckMastery = { deckId: string; name: string; fresh: number; learning: number; solid: number };

// New: never reviewed. Learning: memory stability under 21 days. Solid: 21 days or more.
export function mastery(data: AppData): DeckMastery[] {
  return data.decks
    .filter((deck) => !deck.archived)
    .map((deck) => {
      const result = { deckId: deck.id, name: deck.name, fresh: 0, learning: 0, solid: 0 };
      for (const id of deck.cardIds) {
        const schedule = data.schedules[id];
        if (!schedule) continue;
        if (schedule.state === State.New) result.fresh++;
        else if (schedule.stability >= SOLID_STABILITY_DAYS) result.solid++;
        else result.learning++;
      }
      return result;
    });
}

// ---------- 5. Time studied ----------

export type TimeBucket = { date: Date; label: string; minutes: number };

function minutesBetween(log: ReviewLogEntry[], from: Date, to: Date): number {
  const ms = log
    .filter((entry) => answered(entry) && new Date(entry.at) >= from && new Date(entry.at) < to)
    .reduce((sum, entry) => sum + studyMs(entry), 0);
  return ms / 60_000;
}

// Minutes per day for the last `days` days (today last).
export function minutesPerDay(log: ReviewLogEntry[], now: Date, days = 14): TimeBucket[] {
  const today = startOfDay(now);
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i - (days - 1));
    return {
      date,
      label: date.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      minutes: minutesBetween(log, date, addDays(date, 1)),
    };
  });
}

// Minutes per week (Monday to Sunday) for the last `weeks` weeks (this week last).
export function minutesPerWeek(log: ReviewLogEntry[], now: Date, weeks = 8): TimeBucket[] {
  const thisWeek = startOfWeek(now);
  return Array.from({ length: weeks }, (_, i) => {
    const date = addDays(thisWeek, (i - (weeks - 1)) * 7);
    return {
      date,
      label: date.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      minutes: minutesBetween(log, date, addDays(date, 7)),
    };
  });
}
