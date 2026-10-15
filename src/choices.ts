// Building the options for multiple-choice questions.

import { shuffle } from "./random";

// The right answer plus up to `count` different wrong ones from `candidates`,
// in random order.
export function pickOptions(answer: string, candidates: string[], count = 3): string[] {
  const wrong = shuffle(unique(candidates).filter((c) => c !== answer)).slice(0, count);
  return shuffle([answer, ...wrong]);
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
