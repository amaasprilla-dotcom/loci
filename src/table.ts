// Picking a random multiple-choice question from a TableProblem.

import { pickOptions } from "./choices";
import { fillTemplate } from "./formula";
import { randomIndex } from "./random";
import type { TableProblem } from "./types";

export type TableVariant = {
  prompt: string;
  answer: string;
  options: string[]; // the answer plus up to 3 wrong ones, shuffled
};

export function makeTableVariant(problem: TableProblem): TableVariant {
  const row = randomIndex(problem.rows.length);
  const col = randomIndex(problem.cols.length);
  const answer = problem.cells[row][col];

  const prompt = fillTemplate(problem.prompt, {
    [problem.rowKey]: problem.rows[row],
    [problem.colKey]: problem.cols[col],
  });

  // Wrong options come from the same row and the same column, so they look
  // plausible: for "tener, nosotros" that's other forms of tener ("tienes")
  // and other verbs for nosotros ("hablamos"); for sin(30°) it's other sines
  // and the cosine/tangent of 30°.
  const sameRow = problem.cells[row];
  const sameColumn = problem.cells.map((cells) => cells[col]);
  const options = pickOptions(answer, [...sameRow, ...sameColumn]);

  return { prompt, answer, options };
}
