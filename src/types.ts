// The stored data shapes (SPEC.md, "Data model").
// IDs are crypto.randomUUID(). Timestamps are epoch milliseconds.
// Every record has updatedAt, which import/merge uses to pick the newer copy.

export interface Tag {
  id: string;
  name: string; // as the user typed it
  key: string; // name trimmed and lowercased; unique, so "Math" and "math" can't both exist
  updatedAt: number;
}

export interface Locus {
  id: string;
  name: string;
  color: string; // hex
  tagIds: string[];
  x: number; // home position, normalized 0..1 of the field
  y: number;
  radius: number; // px
  createdAt: number;
  updatedAt: number;
}

// The spec calls this "Element". Renamed so it doesn't clash with the DOM's Element type.
export interface LocusElement<TData = unknown> {
  id: string;
  locusId: string;
  type: string; // key into the element registry, e.g. "flashcards"
  title: string;
  order: number; // position inside the locus view
  data: TData; // type-specific settings
  updatedAt: number;
}

export interface Card {
  id: string;
  elementId: string; // the flashcard deck
  front: string;
  back: string;
  due: number; // next review time
  interval: number; // days
  ease: number; // SM-2 ease factor, starts 2.5
  reps: number; // consecutive successful reviews
  lapses: number;
  createdAt: number;
  updatedAt: number;
}

export type Grade = 0 | 1 | 2 | 3; // Again, Hard, Good, Easy

export interface ReviewLog {
  id: string;
  cardId: string;
  at: number;
  grade: Grade;
  prevInterval: number;
  updatedAt: number;
}
