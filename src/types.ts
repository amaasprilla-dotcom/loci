// The shapes of the data the app stores. See SPEC.md, "Data model".

export type Deck = {
  id: string;
  name: string;
  cardIds: string[];
  packId?: string; // set when the deck came from a built-in pack
  examDate?: string; // "2026-12-01": exam mode is on while this is set (v0.2)
  archived?: boolean; // hidden from studying, e.g. after an exam (v0.2)
  cardBack?: string; // card-back design id, see cardBacks.ts (v0.2)
};

export type Flashcard = {
  id: string;
  type: "flashcard";
  front: string;
  back: string;
  // v0.2: pick the back from 4 options (taken from other cards in the deck),
  // checked by the app. Otherwise: Show answer, then rate yourself.
  choice?: boolean;
};

// A template that makes a fresh numeric problem each time it is reviewed.
// Text may contain {name} placeholders for the variables and for {answer}.
export type FormulaProblem = {
  id: string;
  type: "formula";
  prompt: string; // "A car travels {d} km in {t} h. Average speed in km/h?"
  vars: Record<string, { min: number; max: number; step: number }>;
  answer: string; // mathjs expression, e.g. "d / t"
  tolerance?: number; // default 0.01 (absolute)
  decimals?: number; // how to display the answer, default 2
  solution?: string; // "v = {d} / {t} = {answer}"
};

// A grid of answers. Each review picks one random cell and asks for it.
export type TableProblem = {
  id: string;
  type: "table";
  prompt: string; // "Conjugate {verb} for {person}"
  rowKey: string; // name of the row placeholder in the prompt, e.g. "verb"
  colKey: string; // name of the column placeholder, e.g. "person"
  rows: string[];
  cols: string[];
  cells: string[][]; // cells[row][col] = correct answer
  // v0.1 setting. Since v0.2 every table problem is shown as multiple choice.
  mode: "typed" | "choice";
  ignoreAccents?: boolean; // v0.1, typed mode only
};

export type Card = Flashcard | FormulaProblem | TableProblem;

// ---------- Added in v0.2 ----------

// How a review went.
export type ReviewResult =
  | "flashcard" // a classic flashcard, graded by the user
  | "correct" // checked by the app (problem or multiple-choice flashcard): right
  | "wrong" // checked by the app: wrong
  | "skipped" // skipped without answering (not counted as cleared)
  | "almost" // v0.1 only: typed answer right except for accents
  | "self"; // v0.1 only: problem the user chose to grade themselves

// One line in the review log, written every time a card is reviewed.
// The Progress screen and rewards are calculated from this.
export type ReviewLogEntry = {
  at: string; // when, as an ISO date-time, e.g. "2026-10-15T09:30:00.000Z"
  cardId: string;
  deckId: string;
  cardType: Card["type"];
  result: ReviewResult;
  grade: 1 | 2 | 3 | 4 | null; // Again / Hard / Good / Easy; null if skipped
  stateBefore: "new" | "learning" | "review" | "relearning"; // FSRS state before this review
  durationMs: number; // time from the card appearing to the rating
  practice?: boolean; // extra practice: logged, but the schedule was not changed
};

// Settings and rewards that belong to the user rather than to a deck.
export type Profile = {
  settings: {
    sessionMinutes: 15 | 30 | 45 | 60 | null; // null = until the queue is empty
    sound: boolean;
    calmMode: boolean;
  };
  coins: number;
  unlockedCardBacks: string[];
  badges: string[];
  goalCelebratedOn?: string; // "2026-10-15": the daily-goal moment was shown that day
};
