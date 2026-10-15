// Upgrading saved data from older versions of the app.
//
// Every save has a schemaVersion. When the shape of the data changes, bump
// SCHEMA_VERSION and add one step here that turns the previous version into
// the new one. Steps only ADD things; they never drop the user's data.

import type { Profile } from "./types";

export const SCHEMA_VERSION = 2;

// Saved data straight out of JSON.parse, before we trust its shape.
export type SavedData = Record<string, unknown> & { schemaVersion?: number; version?: number };

export function defaultProfile(): Profile {
  return {
    settings: { sessionMinutes: 30, sound: true, calmMode: false },
    coins: 0,
    unlockedCardBacks: [],
    badges: [],
  };
}

// Which version some saved data is. v0.1 saved `version: 1` instead.
export function versionOf(saved: SavedData): number {
  return saved.schemaVersion ?? saved.version ?? 0;
}

// Brings saved data from any known version up to the current one.
// Throws an Error with a readable message if the version is unknown.
export function migrate(saved: SavedData): SavedData {
  let data = saved;

  if (versionOf(data) === 1) data = fromV1(data);

  if (versionOf(data) > SCHEMA_VERSION) {
    throw new Error("This data was made by a newer version of the app.");
  }
  if (versionOf(data) !== SCHEMA_VERSION) {
    throw new Error("This file is not a backup from this app.");
  }
  return data;
}

// v0.1 -> v0.2: add an empty review log and a default profile.
// Everything that was there (decks, cards, schedules, streak days) is kept as is.
function fromV1(v1: SavedData): SavedData {
  const upgraded: SavedData = {
    ...v1,
    schemaVersion: 2,
    reviewDays: v1.reviewDays ?? [],
    reviewLog: [],
    profile: defaultProfile(),
  };
  delete upgraded.version; // replaced by schemaVersion
  return upgraded;
}
