// Picking a random question from a TableProblem, and checking answers.

import { fillTemplate } from "./formula";
import { randomIndex, shuffle } from "./random";
import type { TableProblem } from "./types";

export type TableVariant = {
  prompt: string;
  answer: string;
  options: string[]; // only used in "choice" mode: the answer plus distractors, shuffled
};

export function makeTableVariant(problem: TableProblem): TableVariant {
  const row = randomIndex(problem.rows.length);
  const col = randomIndex(problem.cols.length);
  const answer = problem.cells[row][col];

  const prompt = fillTemplate(problem.prompt, {
    [problem.rowKey]: problem.rows[row],
    [problem.colKey]: problem.cols[col],
  });

  // Distractors: other different answers from the same column,
  // so they look plausible (e.g. other sine values, not cosines).
  const sameColumn = problem.cells.map((cells) => cells[col]);
  const others = shuffle(unique(sameColumn).filter((cell) => cell !== answer));
  const options = shuffle([answer, ...others.slice(0, 3)]);

  return { prompt, answer, options };
}

// "almost" = right except for accents (only when the card doesn't ignore accents).
export type TypedResult = "correct" | "almost" | "wrong";

export function checkTypedAnswer(input: string, answer: string, ignoreAccents = false): TypedResult {
  const typed = normalize(input);
  const expected = normalize(answer);
  if (typed === expected) return "correct";
  if (removeAccents(typed) === removeAccents(expected)) {
    return ignoreAccents ? "correct" : "almost";
  }
  return "wrong";
}

// Trim, lowercase and squeeze spaces: "  Hablo " -> "hablo".
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// "está" -> "esta". "NFD" splits each letter from its accent mark,
// then \p{M} ("any mark") removes the marks.
function removeAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
