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

// Milestone 3 will add TableProblem to this union.
export type Card = Flashcard | FormulaProblem;
