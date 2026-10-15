// The daily goal (SPEC2 §4.3): clear today's due cards, OR study for your
// session length. Study time is real time spent on cards (from the review
// log), not time the app was open. There's only a goal on days that had
// cards due: practicing on a free day is a bonus, not a requirement.

import { startOfDay } from "./exam";
import type { ReviewLogEntry } from "./types";

// A card left open while you make tea shouldn't count as 20 minutes of study.
const MAX_COUNTED_PER_CARD_MS = 3 * 60 * 1000;

export type DailyGoal = {
  active: boolean; // were there cards due today?
  cleared: number; // different cards reviewed today
  dueLeft: number; // cards due right now
  minutes: number; // study time today
  targetMinutes: number | null; // the session length (null: "until the queue is empty")
  queueDone: boolean;
  timeDone: boolean;
  met: boolean;
};

export function dailyGoal(
  log: ReviewLogEntry[],
  dueLeft: number,
  targetMinutes: number | null,
  now: Date,
): DailyGoal {
  const since = startOfDay(now).toISOString();
  const today = log.filter((entry) => entry.at >= since && entry.result !== "skipped");

  const cleared = new Set(today.filter((entry) => !entry.practice).map((entry) => entry.cardId)).size;
  const minutes =
    today.reduce((sum, entry) => sum + Math.min(entry.durationMs, MAX_COUNTED_PER_CARD_MS), 0) / 60_000;

  const active = cleared > 0 || dueLeft > 0;
  const queueDone = active && dueLeft === 0;
  const timeDone = active && targetMinutes !== null && minutes >= targetMinutes;
  return { active, cleared, dueLeft, minutes, targetMinutes, queueDone, timeDone, met: queueDone || timeDone };
}
