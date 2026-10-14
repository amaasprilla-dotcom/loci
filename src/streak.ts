// The streak: how many days in a row the user has reviewed at least one card.

import { dayKey } from "./storage";

export function currentStreak(reviewDays: string[], now = new Date()): number {
  const days = new Set(reviewDays);
  const day = new Date(now);

  // Not reviewed yet today? The streak isn't broken until today ends,
  // so start counting from yesterday.
  if (!days.has(dayKey(day))) day.setDate(day.getDate() - 1);

  let streak = 0;
  while (days.has(dayKey(day))) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}
