// Evaluating formulas stored as MathJSON (SPEC-v2.md, "Template model").
// MathJSON is plain nested arrays, e.g. ["Divide", "d", "t"], which makes both
// evaluation here and the mutations into wrong answers (distractors.ts) simple
// tree operations. Covers the arithmetic, powers, roots, logs, trig and
// comparisons that MathLive and the Compute Engine produce for school and
// university problems.

import type { MathJSON } from '../../types'

export type Scope = Record<string, number>

// Why a formula couldn't be evaluated. The generator treats 'divide-by-zero' and
// 'not-real' as "try other numbers"; the rest are mistakes in the template.
export class MathError extends Error {
  readonly kind: 'unknown-symbol' | 'unsupported' | 'divide-by-zero' | 'not-real' | 'malformed'
  constructor(kind: MathError['kind'], message: string) {
    super(message)
    this.name = 'MathError'
    this.kind = kind
  }
}

export const CONSTANTS: Record<string, number> = {
  Pi: Math.PI,
  ExponentialE: Math.E,
  Half: 0.5,
}

export const isCall = (e: MathJSON): e is [string, ...MathJSON[]] => Array.isArray(e)
export const headOf = (e: MathJSON): string | null => (isCall(e) ? e[0] : null)
export const argsOf = (e: MathJSON): MathJSON[] => (isCall(e) ? e.slice(1) : [])

// A literal number in any of MathJSON's spellings, or null.
export function numberValue(e: MathJSON): number | null {
  if (typeof e === 'number') return e
  if (typeof e === 'object' && !Array.isArray(e) && typeof e.num === 'string') return parseNumberString(e.num)
  if (isCall(e) && e[0] === 'Rational' && e.length === 3) {
    const [n, d] = [numberValue(e[1]), numberValue(e[2])]
    return n != null && d != null && d !== 0 ? n / d : null
  }
  return null
}

function parseNumberString(s: string): number {
  // The Compute Engine may write repeating decimals as "0.(3)".
  const repeating = /^(-?\d*)\.(\d*)\((\d+)\)$/.exec(s)
  if (repeating) {
    const [, int, fixed, rep] = repeating
    const base = Number(`${int || '0'}.${fixed}`)
    const sign = int.startsWith('-') ? -1 : 1
    return base + (sign * Number(rep)) / (10 ** fixed.length * (10 ** rep.length - 1))
  }
  if (s === 'Infinity' || s === '+Infinity') return Infinity
  if (s === '-Infinity') return -Infinity
  return Number(s.replace(/n$/, ''))
}

const TOLERANCE = 1e-9
const nearlyEqual = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b))

// The value of an expression with the variables in `scope`. Throws MathError.
export function evaluate(expr: MathJSON, scope: Scope): number {
  const literal = numberValue(expr)
  if (literal != null) return literal
  if (typeof expr === 'string') {
    if (expr in scope) return scope[expr]
    if (expr in CONSTANTS) return CONSTANTS[expr]
    throw new MathError('unknown-symbol', `Unknown variable “${expr}”`)
  }
  if (!isCall(expr)) throw new MathError('malformed', 'Not a formula')
  const [head, ...args] = expr
  const ev = (e: MathJSON) => evaluate(e, scope)
  const one = () => {
    if (args.length !== 1) throw new MathError('malformed', `${head} takes one argument`)
    return ev(args[0])
  }
  const two = (): [number, number] => {
    if (args.length !== 2) throw new MathError('malformed', `${head} takes two arguments`)
    return [ev(args[0]), ev(args[1])]
  }
  const real = (x: number) => {
    if (Number.isNaN(x)) throw new MathError('not-real', `${head} has no real value here`)
    return x
  }

  switch (head) {
    case 'Add':
      return args.reduce<number>((sum, a) => sum + ev(a), 0)
    case 'Subtract':
      if (args.length === 1) return -ev(args[0])
      return args.slice(1).reduce<number>((acc, a) => acc - ev(a), ev(args[0]))
    case 'Negate':
      return -one()
    case 'Multiply':
      return args.reduce<number>((product, a) => product * ev(a), 1)
    case 'Divide': {
      const [n, d] = two()
      if (d === 0) throw new MathError('divide-by-zero', 'Division by zero')
      return n / d
    }
    case 'Power': {
      const [b, x] = two()
      if (b === 0 && x < 0) throw new MathError('divide-by-zero', 'Division by zero')
      return real(b ** x)
    }
    case 'Square':
      return one() ** 2
    case 'Sqrt':
      return real(Math.sqrt(one()))
    case 'Root': {
      const [x, n] = two()
      if (n === 0) throw new MathError('divide-by-zero', 'Zeroth root')
      // Odd roots of negatives are real: ∛−8 = −2.
      if (x < 0 && Number.isInteger(n) && Math.abs(n) % 2 === 1) return -((-x) ** (1 / n))
      return real(x ** (1 / n))
    }
    case 'Half':
      return one() / 2
    case 'Exp':
      return Math.exp(one())
    case 'Ln':
      return real(logOf(one()))
    case 'Log':
      if (args.length === 2) {
        const [x, base] = two()
        const lb = logOf(base)
        if (lb === 0) throw new MathError('divide-by-zero', 'Log base 1')
        return real(logOf(x) / lb)
      }
      return real(logOf(one()) / Math.LN10)
    case 'Lg':
      return real(logOf(one()) / Math.LN10)
    case 'Lb':
      return real(logOf(one()) / Math.LN2)
    case 'Abs':
      return Math.abs(one())
    case 'Sin':
      return Math.sin(one())
    case 'Cos':
      return Math.cos(one())
    case 'Tan':
      return Math.tan(one())
    case 'Cot':
      return 1 / Math.tan(one())
    case 'Sec':
      return 1 / Math.cos(one())
    case 'Csc':
      return 1 / Math.sin(one())
    case 'Arcsin':
      return real(Math.asin(one()))
    case 'Arccos':
      return real(Math.acos(one()))
    case 'Arctan':
      return Math.atan(one())
    case 'Sinh':
      return Math.sinh(one())
    case 'Cosh':
      return Math.cosh(one())
    case 'Tanh':
      return Math.tanh(one())
    case 'Floor':
      return Math.floor(one())
    case 'Ceil':
    case 'Ceiling':
      return Math.ceil(one())
    case 'Round':
      return Math.round(one())
    case 'Max':
      return Math.max(...args.map(ev))
    case 'Min':
      return Math.min(...args.map(ev))
    case 'Mod': {
      const [a, m] = two()
      if (m === 0) throw new MathError('divide-by-zero', 'Modulo zero')
      return ((a % m) + m) % m
    }
    case 'Degrees':
      return (one() * Math.PI) / 180
    case 'Delimiter':
      // Parentheses as written: ["Delimiter", x] or ["Delimiter", ["Sequence", x]].
      return evaluate(unwrapDelimiter(expr), scope)
    case 'Sequence':
      return one()
    default:
      throw new MathError('unsupported', `“${head}” isn’t supported in formulas`)
  }
}

function logOf(x: number): number {
  if (x <= 0) return NaN
  return Math.log(x)
}

function unwrapDelimiter(expr: [string, ...MathJSON[]]): MathJSON {
  const inner = expr[1]
  if (isCall(inner) && inner[0] === 'Sequence' && inner.length === 2) return inner[1]
  return inner
}

const COMPARISONS = ['Equal', 'NotEqual', 'Less', 'LessEqual', 'Greater', 'GreaterEqual'] as const

export const isCondition = (e: MathJSON): boolean => {
  const head = headOf(e)
  return head != null && ([...COMPARISONS, 'And', 'Or', 'Not'] as string[]).includes(head)
}

// Whether a condition holds, e.g. ["GreaterEqual", disc, 0]. Chains like
// ["Less", 0, "a", 10] mean 0 < a < 10. Throws MathError.
export function test(expr: MathJSON, scope: Scope): boolean {
  if (!isCall(expr)) throw new MathError('malformed', 'A condition compares two things, e.g. a > 0')
  const [head, ...args] = expr
  switch (head) {
    case 'And':
      return args.every((a) => test(a, scope))
    case 'Or':
      return args.some((a) => test(a, scope))
    case 'Not':
      return !test(args[0], scope)
    case 'Delimiter':
      return test(unwrapDelimiter(expr), scope)
  }
  if (!(COMPARISONS as readonly string[]).includes(head) || args.length < 2) throw new MathError('malformed', 'A condition compares two things, e.g. a > 0')
  const values = args.map((a) => evaluate(a, scope))
  for (let i = 0; i + 1 < values.length; i++) {
    const [a, b] = [values[i], values[i + 1]]
    const ok =
      head === 'Equal'
        ? nearlyEqual(a, b)
        : head === 'NotEqual'
          ? !nearlyEqual(a, b)
          : head === 'Less'
            ? a < b && !nearlyEqual(a, b)
            : head === 'LessEqual'
              ? a < b || nearlyEqual(a, b)
              : head === 'Greater'
                ? a > b && !nearlyEqual(a, b)
                : a > b || nearlyEqual(a, b)
    if (!ok) return false
  }
  return true
}

// The variable names a formula uses (not constants like Pi).
export function symbolsOf(expr: MathJSON, into = new Set<string>()): Set<string> {
  if (typeof expr === 'string') {
    if (!(expr in CONSTANTS)) into.add(expr)
  } else if (isCall(expr)) {
    for (const a of expr.slice(1)) symbolsOf(a, into)
  }
  return into
}
