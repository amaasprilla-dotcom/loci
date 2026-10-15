// Scoring (SPEC2 §4.1).
//
// Every finished card earns points. Answers the app checks (problems and
// multiple-choice flashcards) also build a combo: each right answer in a row
// raises the multiplier by 0.5, up to x4; a wrong answer resets it to x1.
// A card scores its points x the multiplier at the moment it was answered,
// so a late mistake never takes away what was already earned.
//
// Flashcards you grade yourself earn points for finishing, never for the
// rating you pick, and don't touch the multiplier: no reason to fib.

import type { Card, ReviewResult } from "./types";

export const MAX_MULTIPLIER = 4;
const MULTIPLIER_STEP = 0.5;

export function pointsFor(cardType: Card["type"], result: ReviewResult): number {
  if (result === "skipped") return 0;
  if (result === "wrong") return 2; // trying still counts
  if (cardType === "flashcard") return 5;
  return 10; // a problem answered correctly
}

// The multiplier after an answer the app checked.
export function nextMultiplier(multiplier: number, correct: boolean): number {
  return correct ? Math.min(MAX_MULTIPLIER, multiplier + MULTIPLIER_STEP) : 1;
}

// "x1.5", "x2", "x4"
export function formatMultiplier(multiplier: number): string {
  return `×${multiplier}`;
}
