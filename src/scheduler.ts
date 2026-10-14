// A thin wrapper around ts-fsrs, so the rest of the app never talks to it directly.
//
// FSRS keeps a small "memory state" for every card (stability, difficulty,
// next due date, ...). We call that state a Schedule. After each review we
// hand FSRS the old Schedule plus the rating, and it gives back a new one.

import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  TypeConvert,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";

export type Schedule = FsrsCard;
export { Rating, State };
export type { Grade };

const scheduler = fsrs();

// The four buttons the user can press, in display order.
export const GRADES: { grade: Grade; label: string }[] = [
  { grade: Rating.Again, label: "Again" },
  { grade: Rating.Hard, label: "Hard" },
  { grade: Rating.Good, label: "Good" },
  { grade: Rating.Easy, label: "Easy" },
];

// A brand-new card is due right away.
export function newSchedule(now = new Date()): Schedule {
  return createEmptyCard(now);
}

export function isDue(schedule: Schedule, now = new Date()): boolean {
  return schedule.due.getTime() <= now.getTime();
}

// Returns the card's next Schedule after the user rates it.
export function rate(schedule: Schedule, grade: Grade, now = new Date()): Schedule {
  return scheduler.next(schedule, now, grade).card;
}

// What the due date would be for each rating. Used to label the buttons.
export function previewDueDates(schedule: Schedule, now = new Date()): Record<Grade, Date> {
  const preview = scheduler.repeat(schedule, now);
  return {
    [Rating.Again]: preview[Rating.Again].card.due,
    [Rating.Hard]: preview[Rating.Hard].card.due,
    [Rating.Good]: preview[Rating.Good].card.due,
    [Rating.Easy]: preview[Rating.Easy].card.due,
  };
}

// localStorage only holds text, so dates come back as strings.
// This turns a stored schedule back into a real one with Date objects.
export function reviveSchedule(stored: unknown): Schedule {
  return TypeConvert.card(stored as FsrsCard);
}

// "in 10m", "in 3d", "now" ... short enough to fit under a button.
export function formatInterval(from: Date, to: Date): string {
  const minutes = Math.round((to.getTime() - from.getTime()) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
