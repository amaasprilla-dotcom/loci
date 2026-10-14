// The shapes of the data the app stores. See SPEC.md, "Data model".

export type Deck = {
  id: string;
  name: string;
  cardIds: string[];
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
