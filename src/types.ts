// The shapes of the data the app stores. See SPEC.md, "Data model".

export type Deck = {
  id: string;
  name: string;
  cardIds: string[];
  packId?: string; // set when the deck came from a built-in pack
};

export type Flashcard = {
  id: string;
  type: "flashcard";
  front: string;
  back: string;
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
  mode: "typed" | "choice"; // choice = 4 options taken from the same column
  ignoreAccents?: boolean; // typed mode: if true, "esta" counts as "está"
};

export type Card = Flashcard | FormulaProblem | TableProblem;

// ---------- Added in v0.2 ----------

// How a review went.
export type ReviewResult =
  | "flashcard" // a flashcard, graded by the user
  | "correct" // a problem, checked by the app: right
  | "almost" // a problem: right except for accents
  | "wrong" // a problem: wrong
  | "self" // a problem the user chose to grade themselves
  | "skipped"; // skipped without answering (not counted as cleared)

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
};
