// Turning a FormulaProblem template into a concrete problem, and checking answers.

import { evaluate } from "mathjs";
import type { FormulaProblem } from "./types";

// One concrete version of a template: real numbers filled in.
export type FormulaVariant = {
  prompt: string;
  answer: number; // exact value
  answerText: string; // rounded for display, e.g. "12.5"
  solution?: string;
};

export function makeVariant(problem: FormulaProblem): FormulaVariant {
  // Some random values can give an unusable answer (dividing by zero,
  // square root of a negative...). If that happens, just pick again.
  for (let attempt = 0; attempt < 50; attempt++) {
    const values: Record<string, number> = {};
    for (const [name, range] of Object.entries(problem.vars)) {
      values[name] = randomValue(range.min, range.max, range.step);
    }

    // mathjs evaluates the expression safely: no JavaScript eval involved.
    const answer = Number(evaluate(problem.answer, { ...values }));
    if (!Number.isFinite(answer)) continue;

    const answerText = formatNumber(answer, problem.decimals ?? 2);
    const fill = (text: string) => fillTemplate(text, { ...values, answer: answerText });
    return {
      prompt: fill(problem.prompt),
      answer,
      answerText,
      solution: problem.solution ? fill(problem.solution) : undefined,
    };
  }
  throw new Error(`Could not compute an answer for: ${problem.prompt}`);
}

export type CheckResult = "correct" | "wrong" | "not-a-number";

export function checkAnswer(
  input: string,
  variant: FormulaVariant,
  problem: FormulaProblem,
): CheckResult {
  // Accept "12,5" as well as "12.5".
  const text = input.trim().replace(",", ".");
  const typed = Number(text);
  if (text === "" || !Number.isFinite(typed)) return "not-a-number";

  // Typing the rounded answer we display is always fine too, even if
  // rounding moved it a bit further than the tolerance from the exact value.
  const tolerance = (problem.tolerance ?? 0.01) + 1e-9;
  const closeToExact = Math.abs(typed - variant.answer) <= tolerance;
  const closeToShown = Math.abs(typed - Number(variant.answerText)) <= tolerance;
  return closeToExact || closeToShown ? "correct" : "wrong";
}

// Replaces {name} with its value. Unknown {names} are left alone, so
// LaTeX like \text{km} is not touched.
export function fillTemplate(text: string, values: Record<string, number | string>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

// A random number from min to max that is a whole number of steps from min.
function randomValue(min: number, max: number, step: number): number {
  const stepCount = Math.floor((max - min) / step);
  const value = min + step * Math.floor(Math.random() * (stepCount + 1));
  return cleanFloat(value);
}

// Rounds to at most `decimals` places and drops trailing zeros: 12.50 -> "12.5".
function formatNumber(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

// Removes floating-point noise such as 0.30000000000000004.
function cleanFloat(value: number): number {
  return Number(value.toFixed(10));
}
