// Saving and loading everything to the browser's localStorage,
// plus turning data into a backup file and back.

import type { Card, Deck } from "./types";
import { reviveSchedule, type Schedule } from "./scheduler";

export type AppData = {
  version: 1;
  decks: Deck[];
  cards: Record<string, Card>; // card id -> card
  schedules: Record<string, Schedule>; // card id -> FSRS state
  reviewDays: string[]; // days with at least one review, "2026-10-14" (for the streak)
};

const STORAGE_KEY = "study-app-data";
const BACKUP_KEY = "study-app-data-unreadable";

export function emptyData(): AppData {
  return { version: 1, decks: [], cards: {}, schedules: {}, reviewDays: [] };
}

export function loadData(): AppData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyData();

  try {
    return parseData(raw);
  } catch (error) {
    // Don't throw the user's data away: keep a copy before starting fresh.
    console.error("Could not read saved data, starting empty.", error);
    localStorage.setItem(BACKUP_KEY, raw);
    return emptyData();
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// Reads saved or imported JSON text. Throws an Error with a readable
// message if it doesn't look like this app's data.
export function parseData(text: string): AppData {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }

  const looksRight =
    parsed &&
    parsed.version === 1 &&
    Array.isArray(parsed.decks) &&
    typeof parsed.cards === "object" &&
    typeof parsed.schedules === "object";
  if (!looksRight) {
    throw new Error("This file is not a backup from this app.");
  }

  // Dates were saved as text; turn them back into real dates.
  const schedules: Record<string, Schedule> = {};
  for (const [cardId, stored] of Object.entries(parsed.schedules)) {
    schedules[cardId] = reviveSchedule(stored);
  }

  return {
    version: 1,
    decks: parsed.decks,
    cards: parsed.cards,
    schedules,
    reviewDays: Array.isArray(parsed.reviewDays) ? parsed.reviewDays : [],
  };
}

// Makes the browser download the data as a .json file.
export function downloadBackup(data: AppData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `study-app-backup-${dayKey(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// Short random ids. (crypto.randomUUID is not available on plain-http
// pages, e.g. when testing on a phone over the local network.)
export function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// A date as "2026-10-14" in the user's own time zone.
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
