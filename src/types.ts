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

// Milestone 2 and 3 will add FormulaProblem and TableProblem to this union.
export type Card = Flashcard;
