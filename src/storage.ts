// Saving and loading everything to the browser's localStorage,
// plus turning data into a backup file and back.

import type { Card, Deck, Profile, ReviewLogEntry } from "./types";
import { reviveSchedule, type Schedule } from "./scheduler";
import { defaultProfile, migrate, SCHEMA_VERSION, versionOf, type SavedData } from "./migrate";

export type AppData = {
  schemaVersion: typeof SCHEMA_VERSION;
  decks: Deck[];
  cards: Record<string, Card>; // card id -> card
  schedules: Record<string, Schedule>; // card id -> FSRS state
  reviewDays: string[]; // days with at least one review, "2026-10-14" (for the streak)
  reviewLog: ReviewLogEntry[]; // every review ever done, oldest first
  profile: Profile;
};

// These keys keep the app's original working name on purpose: renaming them
// would make every browser "forget" the data already saved under them.
const STORAGE_KEY = "study-app-data";
const UNREADABLE_KEY = "study-app-data-unreadable";
// A copy of the data exactly as it was before it was upgraded to a newer version.
const PRE_UPGRADE_KEY = "study-app-data-before-upgrade";

export function emptyData(): AppData {
  return {
    schemaVersion: SCHEMA_VERSION,
    decks: [],
    cards: {},
    schedules: {},
    reviewDays: [],
    reviewLog: [],
    profile: defaultProfile(),
  };
}

export function loadData(): AppData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyData();

  try {
    const data = parseData(raw);
    // Saved by an older version? Keep the original text untouched, just in case.
    if (versionOf(JSON.parse(raw)) < SCHEMA_VERSION && !localStorage.getItem(PRE_UPGRADE_KEY)) {
      localStorage.setItem(PRE_UPGRADE_KEY, raw);
    }
    return data;
  } catch (error) {
    // Don't throw the user's data away: keep a copy before starting fresh.
    console.error("Could not read saved data, starting empty.", error);
    localStorage.setItem(UNREADABLE_KEY, raw);
    return emptyData();
  }
}

// Returns false if the browser refused (usually because storage is full).
export function saveData(data: AppData): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error("Could not save data.", error);
    return false;
  }
}

// Reads saved or imported JSON text from any version of the app.
// Throws an Error with a readable message if it isn't this app's data.
export function parseData(text: string): AppData {
  let parsed: SavedData;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("This file is not a backup from this app.");
  }

  const data = migrate(parsed);

  const looksRight =
    Array.isArray(data.decks) &&
    isObject(data.cards) &&
    isObject(data.schedules) &&
    Array.isArray(data.reviewLog);
  if (!looksRight) {
    throw new Error("This file is not a backup from this app.");
  }

  // Dates were saved as text; turn them back into real dates.
  const schedules: Record<string, Schedule> = {};
  for (const [cardId, stored] of Object.entries(data.schedules as object)) {
    schedules[cardId] = reviveSchedule(stored);
  }

  // Fill in any profile fields that are missing, keeping the saved ones.
  const savedProfile = (data.profile ?? {}) as Partial<Profile>;
  const profile: Profile = {
    ...defaultProfile(),
    ...savedProfile,
    settings: { ...defaultProfile().settings, ...savedProfile.settings },
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    decks: data.decks as Deck[],
    cards: data.cards as Record<string, Card>,
    schedules,
    reviewDays: Array.isArray(data.reviewDays) ? data.reviewDays : [],
    reviewLog: data.reviewLog as ReviewLogEntry[],
    profile,
  };
}

function isObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Makes the browser download the data as a .json file.
export function downloadBackup(data: AppData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `echomathia-backup-${dayKey(new Date())}.json`;
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
