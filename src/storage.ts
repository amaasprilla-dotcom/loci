// Saving and loading everything to the browser's localStorage.

import type { Card, Deck } from "./types";
import { reviveSchedule, type Schedule } from "./scheduler";

export type AppData = {
  version: 1;
  decks: Deck[];
  cards: Record<string, Card>; // card id -> card
  schedules: Record<string, Schedule>; // card id -> FSRS state
};

const STORAGE_KEY = "study-app-data";
const BACKUP_KEY = "study-app-data-unreadable";

export function emptyData(): AppData {
  return { version: 1, decks: [], cards: {}, schedules: {} };
}

export function loadData(): AppData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyData();

  try {
    const parsed = JSON.parse(raw) as AppData;
    const schedules: Record<string, Schedule> = {};
    for (const [cardId, stored] of Object.entries(parsed.schedules ?? {})) {
      schedules[cardId] = reviveSchedule(stored);
    }
    return {
      version: 1,
      decks: parsed.decks ?? [],
      cards: parsed.cards ?? {},
      schedules,
    };
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

// Short random ids. (crypto.randomUUID is not available on plain-http
// pages, e.g. when testing on a phone over the local network.)
export function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
