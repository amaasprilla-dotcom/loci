// Turning a card into a multiple-choice question.
// Problems are always multiple choice; flashcards only if `choice` is on.

import { pickOptions } from "./choices";
import { makeVariant } from "./formula";
import { makeTableVariant } from "./table";
import type { Card } from "./types";

export type Question = {
  prompt: string;
  answer: string;
  options: string[];
  solution?: string; // worked solution, shown after answering
  askDifficulty: boolean; // problems: after a right answer, ask Hard / Good / Easy
};

// `otherBacks`: backs of the other flashcards in the same deck, used as wrong
// options for multiple-choice flashcards.
export function makeQuestion(card: Card, otherBacks: string[]): Question {
  if (card.type === "formula") {
    const variant = makeVariant(card);
    return {
      prompt: variant.prompt,
      answer: variant.answerText, // the options are rounded text, so compare with that
      options: variant.options,
      solution: variant.solution,
      askDifficulty: true,
    };
  }
  if (card.type === "table") {
    return { ...makeTableVariant(card), askDifficulty: true };
  }
  return {
    prompt: card.front,
    answer: card.back,
    options: pickOptions(card.back, otherBacks),
    askDifficulty: false,
  };
}

// Is this card shown as multiple choice? A multiple-choice flashcard needs
// at least one other card in its deck to borrow a wrong option from;
// otherwise it falls back to Show answer.
export function isMultipleChoice(card: Card, otherBacks: string[]): boolean {
  if (card.type !== "flashcard") return true;
  return card.choice === true && otherBacks.some((back) => back !== card.back);
}
