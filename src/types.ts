// The stored data shapes (SPEC.md, "Data model").
// IDs are crypto.randomUUID(). Timestamps are epoch milliseconds.
// Every record has updatedAt, which import/merge uses to pick the newer copy.

export interface Tag {
  id: string;
  name: string; // as the user typed it
  key: string; // name trimmed and lowercased; unique, so "Math" and "math" can't both exist
  updatedAt: number;
}

// Importance: Low, Medium, High, Critical. Difficulty: Easy, Medium, Hard, Very hard.
export type Level = 1 | 2 | 3 | 4;

export interface Locus {
  id: string;
  name: string;
  color: string; // hex
  tagIds: string[];
  x: number; // home position, normalized 0..1 of the field
  y: number;
  radius: number; // px
  // How the locus's study task (its due reviews) ranks among tasks. Default 3 and 2.
  studyImportance?: Level;
  studyDifficulty?: Level;
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
  srs: Srs; // spaced-repetition state (FSRS)
  createdAt: number;
  updatedAt: number;
  // v1 SM-2 fields: still on cards made before v2, no longer read (SPEC-v2.md, "Data model changes").
  due?: number;
  interval?: number;
  ease?: number;
  reps?: number;
  lapses?: number;
}

// A ts-fsrs card, stored with plain millisecond timestamps instead of Dates, so
// it can be indexed (srs.due) and survives a JSON backup unchanged.
export interface Srs {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: 0 | 1 | 2 | 3; // New, Learning, Review, Relearning
  last_review?: number;
}

export type Grade = 0 | 1 | 2 | 3; // Again, Hard, Good, Easy (FSRS ratings 1–4)

export interface ReviewLog {
  id: string;
  cardId: string;
  at: number;
  grade: Grade;
  prevInterval: number; // days scheduled before this review
  updatedAt: number;
}

// Links (SPEC-v2.md, "Links"): every relationship between two items is one row.
// Feature tables never store another item's id; they point at the link.
export type ItemType = 'locus' | 'element' | 'todo' | 'goal' | 'note' | 'card' | 'template' | 'exam';
export interface ItemRef {
  type: ItemType;
  id: string;
}

export type LinkKind =
  | 'contributes' // to-do → goal
  | 'after' // to-do or goal → to-do (waits for it)
  | 'scope' // deck / problem set → exam
  | 'related'; // any → any, made by the user

export interface Link {
  id: string;
  from: ItemRef;
  to: ItemRef;
  kind: LinkKind;
  createdAt: number;
  updatedAt: number;
}
