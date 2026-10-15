// Turning a FormulaProblem template into a concrete multiple-choice problem.

import {
  evaluate,
  isConstantNode,
  isFunctionNode,
  isOperatorNode,
  isParenthesisNode,
  isSymbolNode,
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

// Three wrong answers that are hard to rule out. They are what you'd get by
// making a typical mistake in the formula (see `mistakes` below), and the
// ones closest to the right answer are preferred, because those are the
// tempting ones. If there aren't enough, small slips in one step fill the gaps.
function wrongAnswers(
  problem: FormulaProblem,
  values: Record<string, number>,
  answer: number,
  decimals: number,
): string[] {
  const answerText = formatNumber(answer, decimals);
  // A wrong option must be clearly different, not just a rounding away from the answer.
  const minGap = Math.max(problem.tolerance ?? 0.01, Math.abs(answer) * 0.03);

  // How far a value is from the answer, in "times bigger or smaller": 0 = same size.
  const distance = (value: number) => Math.abs(Math.log(Math.abs(value / answer)));

  function usable(value: unknown, taken: string[]): value is number {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (Math.sign(value) !== Math.sign(answer)) return false; // a wrong sign is too easy to spot
    if (Math.abs(value - answer) < minGap) return false;
    const text = formatNumber(value, decimals);
    return Number(text) !== 0 && text !== answerText && !taken.includes(text);
  }

  // 1. Results of typical mistakes, closest first. Wildly off ones (over 6x) are left out.
  const tempting: { text: string; distance: number }[] = [];
  for (const formula of mistakes(problem.answer)) {
    const value = evaluateSafely(formula, values);
    const taken = tempting.map((t) => t.text);
    if (usable(value, taken) && distance(value) < Math.log(6)) {
      tempting.push({ text: formatNumber(value, decimals), distance: distance(value) });
    }
  }
  const chosen = tempting
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((t) => t.text);

  // 2. Not enough? Add slips: one step worked out a bit wrong.
  for (const factor of shuffle([0.8, 1.2, 0.75, 1.25, 0.9, 1.1, 1.5, 0.5])) {
    if (chosen.length === 3) break;
    const value = answer * factor;
    if (usable(value, chosen)) chosen.push(formatNumber(value, decimals));
  }
  return chosen;
}

function evaluateSafely(formula: string, values: Record<string, number>): unknown {
  try {
    return evaluate(formula, { ...values });
  } catch {
    return NaN; // this mistake doesn't make sense for these numbers
  }
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

// Versions of a formula, each with one typical mistake. Returned as text.
function mistakes(expression: string): string[] {
  const formula = parse(expression);
  const base = formula.toString();
  const result: string[] = [];

  // A mistake at one spot (see mistakesAt).
  formula.traverse((node) => {
    for (const wrongVersion of mistakesAt(node)) {
      result.push(formula.transform((n) => (n === node ? wrongVersion : n)).toString());
    }
  });

  // Order of operations ignored: everything worked out left to right,
  // e.g. u + a * t  ->  (u + a) * t.
  result.push(leftToRight(formula));

  // Brackets forgotten, e.g. (v - u) / t  ->  v - u / t.
  formula.traverse((node) => {
    if (isParenthesisNode(node)) {
      result.push(base.replace(node.toString(), node.content.toString()));
    }
  });

  return result;
}

// Mistakes at a single spot in the formula:
//   + and - swapped, * and / swapped, a fraction upside down,
//   a step left out (a term or a factor missing), a power or square root forgotten,
//   sin and cos mixed up, a half (0.5) left out, or degrees used as radians.
function mistakesAt(node: MathNode): MathNode[] {
  if (isOperatorNode(node) && node.args.length === 2) {
    const [left, right] = node.args;
    // "A deg": forgetting the calculator is in radians.
    if (node.implicit) {
      return isSymbolNode(right) && right.name === "deg" ? [left] : [];
    }
    const result: MathNode[] = [];
    const opposite = OPPOSITE[node.op];
    if (opposite) result.push(withOperator(node, opposite[0], opposite[1]));
    if (node.op === "/") result.push(withOperator(node, "/", "divide", true)); // upside down
    if (["+", "-", "*"].includes(node.op)) result.push(left, right); // a step left out
    if (node.op === "^") result.push(left); // forgot the power
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

// The formula's operations done strictly left to right, ignoring which comes first.
function leftToRight(formula: MathNode): string {
  const parts: string[] = []; // e.g. ["u", "+", "a", "*", "t"]
  function walk(node: MathNode) {
    if (isOperatorNode(node) && node.args.length === 2 && !node.implicit) {
      walk(node.args[0]);
      parts.push(node.op);
      walk(node.args[1]);
    } else {
      parts.push(node.toString()); // brackets and function calls stay whole
    }
  }
  walk(formula);
  let text = parts[0];
  for (let i = 1; i < parts.length; i += 2) text = `(${text} ${parts[i]} ${parts[i + 1]})`;
  return text;
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
