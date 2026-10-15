// Points for a finished card (SPEC2 §4.1). They pop off the card when it's played.
// Flashcards graded by the user earn points for finishing, never for the rating
// chosen, so there's no reason to fib. (The full score with a combo multiplier
// is the next milestone.)

import type { Card, ReviewResult } from "./types";

export function pointsFor(cardType: Card["type"], result: ReviewResult): number {
  if (result === "skipped") return 0;
  if (result === "wrong") return 2; // trying still counts
  if (cardType === "flashcard") return 5;
  return 10; // a problem answered correctly
}
