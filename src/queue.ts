// The order cards are shown in during a session.

import { shuffle } from "./random";

// Mixes all cards (so decks and card types interleave), then spreads the
// new problem templates evenly through the session instead of bunching them.
export function orderSession(cardIds: string[], isNewProblem: (id: string) => boolean): string[] {
  const newProblems = shuffle(cardIds.filter(isNewProblem));
  const others = shuffle(cardIds.filter((id) => !isNewProblem(id)));
  const total = cardIds.length;

  const result: string[] = [];
  let next = 0; // next card from `others` to place
  newProblems.forEach((id, i) => {
    // E.g. 2 new problems in 10 cards land at positions 3 and 8.
    const position = Math.round(((i + 0.5) * total) / newProblems.length);
    while (result.length < position && next < others.length) result.push(others[next++]);
    result.push(id);
  });
  result.push(...others.slice(next));
  return result;
}

// Puts a card back into the queue to see it again later in the session:
// at the end, so other cards come first. (A card only comes straight back
// if it is the last one left.)
export function requeue(queue: string[], cardId: string): string[] {
  return [...queue, cardId];
}
