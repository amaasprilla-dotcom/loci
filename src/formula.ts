// Turning a FormulaProblem template into a concrete multiple-choice problem.

import {
  evaluate,
  isConstantNode,
  isFunctionNode,
  isOperatorNode,
  parse,
  type ConstantNode,
  type FunctionNode,
  type MathNode,
} from "mathjs";
import { shuffle } from "./random";
import type { FormulaProblem } from "./types";

// One concrete version of a template: real numbers filled in.
export type FormulaVariant = {
  prompt: string;
  answer: number; // exact value
  answerText: string; // rounded for display, e.g. "12.5"
  options: string[]; // answerText plus 3 wrong answers, shuffled
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

    const decimals = problem.decimals ?? 2;
    const answerText = formatNumber(answer, decimals);
    const wrong = wrongAnswers(problem, values, answer, decimals);
    const fill = (text: string) => fillTemplate(text, { ...values, answer: answerText });
    return {
      prompt: fill(problem.prompt),
      answer,
      answerText,
      options: shuffle([answerText, ...wrong]),
      solution: problem.solution ? fill(problem.solution) : undefined,
    };
  }
  throw new Error(`Could not compute an answer for: ${problem.prompt}`);
}

// Three believable wrong answers. First choice: the result of a typical
// mistake in the formula (see `mistakes` below). If there aren't enough of
// those, use simple slips like a factor of 2 or 10.
function wrongAnswers(
  problem: FormulaProblem,
  values: Record<string, number>,
  answer: number,
  decimals: number,
): string[] {
  const answerText = formatNumber(answer, decimals);
  const tolerance = problem.tolerance ?? 0.01;
  const chosen: string[] = [];

  const fromMistakes = shuffle(mistakes(parse(problem.answer))).map((node) => {
    try {
      return node.evaluate({ ...values });
    } catch {
      return NaN; // this mistake doesn't make sense for these numbers
    }
  });
  const fromSlips = shuffle([2, 0.5, 10, 0.1, 1.5]).map((factor) => answer * factor);

  for (const value of [...fromMistakes, ...fromSlips]) {
    if (chosen.length === 3) break;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (Math.sign(value) !== Math.sign(answer)) continue; // a wrong sign is too easy to rule out
    if (Math.abs(value - answer) <= tolerance) continue; // too close to count as wrong
    const text = formatNumber(value, decimals);
    if (Number(text) === 0) continue; // rounds to 0: an obvious throwaway option
    if (text !== answerText && !chosen.includes(text)) chosen.push(text);
  }
  return chosen;
}

const OPPOSITE: Record<string, [string, string]> = {
  "+": ["-", "subtract"],
  "-": ["+", "add"],
  "*": ["/", "divide"],
  "/": ["*", "multiply"],
};
const MIXED_UP: Record<string, string> = {
  sin: "cos",
  cos: "sin",
  tan: "sin",
  asin: "acos",
  acos: "asin",
  atan: "asin",
};

// Copies of a formula, each with one typical mistake:
// + and - swapped, * and / swapped, a fraction upside down, a square forgotten,
// a square root forgotten, sin and cos mixed up, or 0.5 (a half) left out.
function mistakes(formula: MathNode): MathNode[] {
  const result: MathNode[] = [];
  formula.traverse((node) => {
    for (const wrongVersion of mistakesAt(node)) {
      result.push(formula.transform((n) => (n === node ? wrongVersion : n)));
    }
  });
  return result;
}

function mistakesAt(node: MathNode): MathNode[] {
  if (isOperatorNode(node) && node.args.length === 2 && !node.implicit) {
    const result: MathNode[] = [];
    const opposite = OPPOSITE[node.op];
    if (opposite) result.push(withOperator(node, opposite[0], opposite[1]));
    if (node.op === "/") result.push(withOperator(node, "/", "divide", true)); // upside down
    if (node.op === "^") result.push(node.args[0]); // forgot the power
    return result;
  }
  if (isFunctionNode(node)) {
    const name = node.fn.name;
    if (name === "sqrt") return [node.args[0]]; // forgot the square root
    if (MIXED_UP[name]) return [withFunction(node, MIXED_UP[name])];
  }
  if (isConstantNode(node) && node.value === 0.5) {
    const one = node.clone() as ConstantNode;
    one.value = 1; // forgot the half
    return [one];
  }
  return [];
}

// A copy of an operator node with a different operator (and optionally the two sides swapped).
function withOperator(node: MathNode & { args: MathNode[] }, op: string, fn: string, swapSides = false): MathNode {
  const copy = node.clone() as unknown as { op: string; fn: string; args: MathNode[] };
  copy.op = op;
  copy.fn = fn;
  if (swapSides) copy.args = [node.args[1], node.args[0]];
  return copy as unknown as MathNode;
}

// A copy of a function call with a different function, e.g. sin(x) -> cos(x).
function withFunction(node: FunctionNode, name: string): MathNode {
  const copy = node.clone() as FunctionNode;
  copy.fn = copy.fn.clone();
  copy.fn.name = name;
  return copy;
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
export function formatNumber(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

// Removes floating-point noise such as 0.30000000000000004.
function cleanFloat(value: number): number {
  return Number(value.toFixed(10));
}
