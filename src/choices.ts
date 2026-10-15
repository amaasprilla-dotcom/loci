// Building the options for multiple-choice questions.

import { shuffle } from "./random";

// The right answer plus up to `count` different wrong ones from `candidates`,
// in random order.
export function pickOptions(answer: string, candidates: string[], count = 3): string[] {
  const wrong = shuffle(unique(candidates).filter((c) => c !== answer)).slice(0, count);
  return shuffle([answer, ...wrong]);
}

// Like pickOptions, but the wrong options are the candidates that look most
// like the answer: math next to math, short next to short, sharing words or
// symbols. "2 sin x cos x" gets other short formulas as options, not a
// long sentence that is obviously wrong.
export function pickSimilarOptions(answer: string, candidates: string[], count = 3): string[] {
  const others = shuffle(unique(candidates).filter((c) => c !== answer)); // shuffle: ties in random order
  const ranked = others.sort((a, b) => similarity(answer, b) - similarity(answer, a));
  return shuffle([answer, ...ranked.slice(0, count)]);
}

// 0 (nothing alike) to 3 (very alike).
function similarity(a: string, b: string): number {
  const isMath = (text: string) => text.includes("$");
  const sameKind = isMath(a) === isMath(b) ? 1 : 0;

  const lengthA = a.length;
  const lengthB = b.length;
  const sameLength = Math.min(lengthA, lengthB) / Math.max(lengthA, lengthB);

  // Shared words and math commands (\sin, \cos...), as a share of all of them.
  const wordsA = words(a);
  const wordsB = words(b);
  const shared = [...wordsA].filter((w) => wordsB.has(w)).length;
  const allWords = new Set([...wordsA, ...wordsB]).size;
  const sharedWords = allWords === 0 ? 0 : shared / allWords;

  return sameKind + sameLength + sharedWords;
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/\\?[a-záéíóúñü]+|\d+/g) ?? []);
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
