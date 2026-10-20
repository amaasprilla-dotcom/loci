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
  // FSRS desired retention for cards here: 0.8–0.95, default 0.9.
  retention?: number;
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

// Attachments (SPEC-v2.md, "Attachments"): links and files on notes, to-dos and goals.
// Files live in the blobs table; an attachment points at one.
export type AttachmentOwner = 'note' | 'todo' | 'goal';
export type AttachmentKind = 'link' | 'image' | 'audio' | 'video' | 'pdf' | 'file';

export interface Attachment {
  id: string;
  ownerType: AttachmentOwner;
  ownerId: string;
  kind: AttachmentKind;
  name: string; // a link's title, or the file name
  url?: string; // links
  blobId?: string; // files
  mime?: string;
  size?: number; // bytes
  inline?: boolean; // shown inside the content (an image in a note), not in the strip
  createdAt: number;
  updatedAt: number;
}

export interface StoredBlob {
  id: string;
  data: Blob;
  mime: string;
  size: number;
  updatedAt: number;
}

// App-wide preferences, one row each (e.g. number format).
export interface Setting {
  key: string;
  value: unknown;
  updatedAt: number;
}

// A note in a Notes element (a notebook). Content is the editor's ProseMirror JSON;
// plainText is derived from it on every save, for search and the list's first line.
export interface Note {
  id: string;
  elementId: string;
  title: string;
  content: unknown;
  plainText: string;
  pinned: 0 | 1; // a number, since IndexedDB can't index booleans
  createdAt: number;
  updatedAt: number;
}

// A to-do's when (SPEC-v2.md, "The when model"). "after" and "goal" wait on another
// item through an "after" link; once that fires they become { kind: 'at', at: now }.
export type When =
  | { kind: 'at'; at: number; hasTime: boolean } // date-only: `at` is 04:00 that day
  | { kind: 'repeat'; rrule: string; time?: string; next: number } // RFC 5545, with DTSTART
  | { kind: 'after' }
  | { kind: 'goal'; percent: number }
  | { kind: 'when'; condition: string; firedAt?: number }
  | { kind: 'someday' };

export interface Todo {
  id: string;
  elementId: string;
  title: string; // the action
  why?: string;
  importance: Level;
  difficulty: Level;
  when: When;
  status: 'open' | 'done' | 'archived';
  doneAt?: number;
  createdAt: number;
  updatedAt: number;
}

// One row per occurrence dealt with. Goals count these.
export interface TodoCompletion {
  id: string;
  todoId: string;
  occurrenceAt: number; // the scheduled time it belonged to
  doneAt?: number; // missing = skipped / missed
  outcome: 'done' | 'skipped' | 'missed';
  updatedAt: number;
}

export type RepeatWhen = Extract<When, { kind: 'repeat' }>;

// A goal in a Goals element (SPEC-v2.md, "Goals"). Its progress is the weighted
// average of its contributors'; it always has at least one.
export interface Goal {
  id: string;
  elementId: string;
  title: string;
  why?: string;
  deadline?: number; // end of that day; none = open-ended
  startAt: number; // to-do completions count from here; pace measures from here
  status: 'open' | 'achieved' | 'archived'; // "Ended" is an open goal past its deadline
  notifyCheckins: boolean; // opt-in, used once notifications exist (A3)
  createdAt: number;
  updatedAt: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  doneAt?: number;
}

// What counts toward a goal, each with an exact target.
export type Contributor = {
  id: string;
  goalId: string;
  title: string; // "Violin sessions", "Weight", "How far along are you?"
  importance: Level; // a to-do count takes these from its to-do
  difficulty: Level;
  weightOverride?: number;
  order: number;
  createdAt: number;
  updatedAt: number;
} & (
  | { kind: 'todoCount'; linkId: string; target: number } // completions since the goal started
  | { kind: 'number'; start: number; target: number; unit?: string; schedule: RepeatWhen } // e.g. 80 → 75 kg
  | { kind: 'slider'; start: number; target: number; max: number; unit?: string; schedule: RepeatWhen } // e.g. 3 → 8 of 10
  | { kind: 'checklist'; items: ChecklistItem[]; target: number | 'all' }
);

// One check-in answer. Progress uses the latest; the history draws the chart.
export interface GoalEntry {
  id: string;
  contributorId: string;
  at: number;
  value: number;
  updatedAt: number;
}
