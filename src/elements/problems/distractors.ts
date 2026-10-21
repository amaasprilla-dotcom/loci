// Realistic wrong answers (SPEC-v2.md, "Realistic wrong answers"). Each wrong
// option comes from one mistake rule applied to the answer formula (or to a
// derived value it uses), evaluated with the same numbers, so every option is an
// error a student could actually make, and picking it can name that error.

import type { MathJSON, ProblemTemplate } from '../../types'
import { type Instance, roundAnswer, type Rng, rngFor } from './engine'
import { evaluate, isCall, MathError, numberValue, type Scope } from './mathjson'

export type RuleId = 'custom' | 'order' | 'dropped-factor' | 'dropped-term' | 'sign' | 'inverted' | 'power' | 'wrong-variable' | 'unit' | 'near-miss'

// What went wrong, for the feedback: words, with an optional formula (LaTeX
// source as MathJSON) set in math after them.
export interface Explanation {
  text: string
  expr?: MathJSON
}

export interface Mutation {
  rule: RuleId
  why: Explanation
  // Which formula changed: the answer, or a derived value (by index).
  target: 'answer' | number
  expr: MathJSON
}

export interface Option {
  value: number // rounded to the answer format, as shown
  correct: boolean
  rule?: RuleId
  why?: Explanation
}

// ---------- Tree helpers ----------

type Path = number[]

function* walk(e: MathJSON, path: Path = []): Generator<[MathJSON, Path]> {
  yield [e, path]
  if (isCall(e)) for (let i = 1; i < e.length; i++) yield* walk(e[i], [...path, i])
}

function replaceAt(e: MathJSON, path: Path, by: MathJSON): MathJSON {
  if (path.length === 0) return by
  if (!isCall(e)) return e
  const [i, ...rest] = path
  const copy = [...e] as [string, ...MathJSON[]]
  copy[i] = replaceAt(e[i], rest, by)
  return copy
}

const product = (factors: MathJSON[]): MathJSON => (factors.length === 0 ? 1 : factors.length === 1 ? factors[0] : ['Multiply', ...factors])
const sum = (terms: MathJSON[]): MathJSON => (terms.length === 0 ? 0 : terms.length === 1 ? terms[0] : ['Add', ...terms])
const head = (e: MathJSON) => (isCall(e) ? e[0] : null)
const isNumberNode = (e: MathJSON) => numberValue(e) != null && !isCall(e)

function replaceSymbol(e: MathJSON, from: string, by: MathJSON): MathJSON {
  if (e === from) return by
  if (isCall(e)) return [e[0], ...e.slice(1).map((a) => replaceSymbol(a, from, by))]
  return e
}

// One spelling for sums, so every rule sees every term: a − b is a + (−b), and
// brackets as written are just their contents.
export function normalize(e: MathJSON): MathJSON {
  if (!isCall(e)) return e
  const args = e.slice(1).map(normalize)
  switch (e[0]) {
    case 'Subtract':
      return args.length === 1 ? ['Negate', args[0]] : ['Add', args[0], ...args.slice(1).map((a): MathJSON => (isNumberNode(a) ? -(numberValue(a) as number) : ['Negate', a]))]
    case 'Delimiter':
      return isCall(args[0]) && args[0][0] === 'Sequence' ? args[0][1] : args[0]
  }
  return [e[0], ...args]
}

function usesSymbol(e: MathJSON, name: string): boolean {
  if (e === name) return true
  return isCall(e) && e.slice(1).some((a) => usesSymbol(a, name))
}

// ---------- Unit conversions behind unit slips ----------

const CONVERSIONS: Record<string, [string, number][]> = {
  km: [['m', 1000]],
  m: [['cm', 100], ['mm', 1000]],
  cm: [['m', 100], ['mm', 10]],
  mm: [['cm', 10], ['m', 1000]],
  h: [['min', 60], ['s', 3600]],
  min: [['s', 60], ['h', 60]],
  s: [['min', 60], ['ms', 1000]],
  ms: [['s', 1000]],
  kg: [['g', 1000]],
  g: [['kg', 1000]],
  'km/h': [['m/s', 3.6]],
  'm/s': [['km/h', 3.6]],
  '%': [['a fraction', 100]],
  kW: [['W', 1000]],
  W: [['kW', 1000]],
  kJ: [['J', 1000]],
  J: [['kJ', 1000]],
  mA: [['A', 1000]],
  A: [['mA', 1000]],
  kΩ: [['Ω', 1000]],
  L: [['mL', 1000]],
  mL: [['L', 1000]],
}

// ---------- The rules ----------

// Every single-mistake version of the template's formulas.
export function mutations(t: Pick<ProblemTemplate, 'answer' | 'derived' | 'vars'>): Mutation[] {
  const out: Mutation[] = []
  const targets: ['answer' | number, MathJSON][] = [['answer', normalize(t.answer)], ...t.derived.map((d, i) => [i, normalize(d.expr)] as [number, MathJSON])]
  for (const [target, root] of targets) {
    const add = (rule: RuleId, path: Path, by: MathJSON, why: Explanation) => out.push({ rule, why, target, expr: replaceAt(root, path, by) })
    for (const [node, path] of walk(root)) {
      if (!isCall(node)) continue
      const [h, ...args] = node

      if (h === 'Add') {
        // Dropped term, and a sign slip on each term.
        args.forEach((term, i) => {
          add('dropped-term', path, sum(args.filter((_, j) => j !== i)), { text: 'Left out the term', expr: head(term) === 'Negate' ? (term as [string, ...MathJSON[]])[1] : term })
          const flipped: MathJSON = head(term) === 'Negate' ? (term as [string, ...MathJSON[]])[1] : isNumberNode(term) ? -(numberValue(term) as number) : ['Negate', term]
          add('sign', path, sum(args.map((a, j) => (j === i ? flipped : a))), { text: 'Got the sign wrong on', expr: head(term) === 'Negate' ? (term as [string, ...MathJSON[]])[1] : term })
        })
        // Order of operations: a + b·c worked as (a + b)·c.
        const i = args.findIndex((a, j) => j > 0 && (head(a) === 'Multiply' || head(a) === 'Divide'))
        if (i > 0) {
          const before = sum(args.slice(0, i))
          const term = args[i] as [string, ...MathJSON[]]
          const merged: MathJSON =
            term[0] === 'Multiply' ? product([sum([before, term[1]]), ...term.slice(2)]) : ['Divide', sum([before, term[1]]), term[2]]
          add('order', path, sum([merged, ...args.slice(i + 1)]), { text: term[0] === 'Multiply' ? 'Added before multiplying' : 'Added before dividing' })
        }
      }
      if (h === 'Negate') add('sign', path, args[0], { text: 'Got the sign wrong on', expr: args[0] })

      if (h === 'Multiply') {
        args.forEach((factor, i) => add('dropped-factor', path, product(args.filter((_, j) => j !== i)), { text: 'Left out the factor', expr: factor }))
        // Order of operations: a(b + c) worked as ab + c.
        args.forEach((factor, i) => {
          if (head(factor) !== 'Add') return
          const [first, ...rest] = (factor as [string, ...MathJSON[]]).slice(1)
          add('order', path, sum([product([...args.slice(0, i), first, ...args.slice(i + 1)]), ...rest]), { text: 'Multiplied only part of the brackets' })
        })
      }

      if (h === 'Divide') {
        const [n, d] = args
        add('inverted', path, ['Divide', d, n], { text: 'Divided the wrong way round:', expr: ['Divide', d, n] })
        if (!isNumberNode(d) || numberValue(d) !== 1) add('dropped-factor', path, n, { text: 'Forgot to divide by', expr: d })
        // Order of operations: (a + b) / c worked as a + b / c.
        if (head(n) === 'Add') {
          const terms = (n as [string, ...MathJSON[]]).slice(1)
          add('order', path, sum([...terms.slice(0, -1), ['Divide', terms[terms.length - 1], d]]), { text: 'Divided only part of the top' })
        }
        // x / (2a) worked as x / 2 · a.
        if (head(d) === 'Multiply') {
          const [f1, ...fs] = (d as [string, ...MathJSON[]]).slice(1)
          add('order', path, product([['Divide', n, f1], ...fs]), { text: 'Multiplied by what should divide' })
        }
      }
      if (h === 'Rational' && args.length === 2) add('inverted', path, ['Divide', args[1], args[0]], { text: 'Turned the fraction upside down' })

      if (h === 'Power') {
        const [b, x] = args
        const n = numberValue(x)
        if (n === 2) add('power', path, ['Multiply', 2, b], { text: 'Doubled instead of squaring:', expr: node })
        else if (n === 3) add('power', path, ['Multiply', 3, b], { text: 'Tripled instead of cubing:', expr: node })
        if (n === -1) add('inverted', path, b, { text: 'Forgot to take the reciprocal of', expr: b })
        else if (n === 0.5) add('power', path, b, { text: 'Forgot the square root of', expr: b })
        else add('power', path, b, { text: 'Forgot the power in', expr: node })
      }
      if (h === 'Square') {
        add('power', path, ['Multiply', 2, args[0]], { text: 'Doubled instead of squaring:', expr: node })
        add('power', path, args[0], { text: 'Forgot to square', expr: args[0] })
      }
      if (h === 'Sqrt') {
        add('power', path, args[0], { text: 'Forgot the square root:', expr: node })
        add('power', path, ['Divide', args[0], 2], { text: 'Halved instead of taking the square root:', expr: node })
      }
      if (h === 'Root') add('power', path, args[0], { text: 'Forgot the root:', expr: node })
    }

    // Wrong variable: two quantities in the same unit, swapped.
    for (const a of t.vars) {
      for (const b of t.vars) {
        if (a === b || !a.unit || a.unit !== b.unit || !usesSymbol(root, a.name)) continue
        out.push({ rule: 'wrong-variable', why: { text: `Used ${b.name} where ${a.name} goes` }, target, expr: replaceSymbol(root, a.name, b.name) })
      }
    }
    // Unit slips: a quantity taken in a neighbouring unit.
    for (const v of t.vars) {
      if (!v.unit || !usesSymbol(root, v.name)) continue
      for (const [other, f] of CONVERSIONS[v.unit] ?? []) {
        const text = `Mixed up ${v.unit} and ${other} (off by ${f})`
        out.push({ rule: 'unit', why: { text }, target, expr: replaceSymbol(root, v.name, ['Multiply', v.name, f]) })
        out.push({ rule: 'unit', why: { text }, target, expr: replaceSymbol(root, v.name, ['Divide', v.name, f]) })
      }
    }
  }
  return out
}

// ---------- Evaluating a candidate ----------

// The answer when one formula is swapped for a mutated one, with the same numbers.
export function evaluateMutation(t: Pick<ProblemTemplate, 'answer' | 'derived' | 'vars'>, m: Pick<Mutation, 'target' | 'expr'>, inst: Pick<Instance, 'values'>): number | null {
  try {
    const values: Scope = {}
    for (const v of t.vars) values[v.name] = inst.values[v.name]
    t.derived.forEach((d, i) => (values[d.name] = evaluate(m.target === i ? m.expr : d.expr, values)))
    const x = evaluate(m.target === 'answer' ? m.expr : t.answer, values)
    return Number.isFinite(x) ? x : null
  } catch (e) {
    if (e instanceof MathError) return null
    throw e
  }
}

// ---------- Filtering and choosing ----------

export const MIN_DIFFERENCE = 0.02 // a wrong option is at least 2% away from the answer
export const MAX_MAGNITUDE = 1000 // and within 1000× of it

export function plausible(value: number, correct: number, rule: RuleId, format: ProblemTemplate['answerFormat']): boolean {
  if (!Number.isFinite(value)) return false
  const r = roundAnswer(value, format)
  if (r === roundAnswer(correct, format)) return false
  if (correct !== 0) {
    if (Math.abs(value - correct) < MIN_DIFFERENCE * Math.abs(correct)) return false
    const ratio = Math.abs(value) / Math.abs(correct)
    if (ratio > MAX_MAGNITUDE || ratio < 1 / MAX_MAGNITUDE) return false
    if (rule !== 'sign' && Math.sign(r) !== Math.sign(correct) && r !== 0) return false
    if (rule !== 'sign' && r === 0) return false
  }
  return true
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Near misses, when the rules give too few: off by 10–30%, or two digits swapped.
function nearMisses(correct: number, format: ProblemTemplate['answerFormat'], rng: Rng): { value: number; why: Explanation }[] {
  const out: { value: number; why: Explanation }[] = []
  const shown = String(Math.abs(roundAnswer(correct, format)))
  for (let i = 0; i + 1 < shown.length; i++) {
    const [a, b] = [shown[i], shown[i + 1]]
    if (a === b || a === '.' || b === '.' || a === 'e' || b === 'e' || (i === 0 && b === '0')) continue
    const swapped = Number(shown.slice(0, i) + b + a + shown.slice(i + 2)) * Math.sign(correct || 1)
    out.push({ value: swapped, why: { text: 'Swapped two digits' } })
  }
  for (let i = 0; i < 6; i++) {
    const f = 1 + (rng() < 0.5 ? -1 : 1) * (0.1 + 0.2 * rng())
    out.push({ value: correct * f, why: { text: 'A slip in the arithmetic' } })
  }
  return shuffle(out, rng)
}

// The four options for an instance: the answer and three wrong ones, each from a
// different mistake where possible, author-defined mistakes first. All rounded
// the same way and shuffled; the same instance always gets the same options.
export function chooseOptions(t: Pick<ProblemTemplate, 'answer' | 'derived' | 'vars' | 'answerFormat' | 'customDistractors'>, inst: Instance, count = 3): Option[] {
  const rng = rngFor(`${inst.seed}:options`)
  const f = t.answerFormat
  const correct = inst.answer
  const taken = new Set([roundAnswer(correct, f)])
  const picked: Option[] = []
  const tryAdd = (value: number | null, rule: RuleId, why: Explanation) => {
    if (picked.length >= count || value == null || !Number.isFinite(value)) return false
    const r = roundAnswer(value, f)
    if (taken.has(r) || !plausible(r, correct, rule, f)) return false
    taken.add(r)
    picked.push({ value: r, correct: false, rule, why })
    return true
  }

  // Author-defined mistakes come first.
  for (const c of t.customDistractors) {
    let value: number | null = null
    try {
      value = evaluate(c.expr, inst.values)
    } catch (e) {
      if (!(e instanceof MathError)) throw e
    }
    tryAdd(value, 'custom', { text: c.label })
  }

  // Then a random mix of the rules, one per rule before any rule repeats.
  const candidates = shuffle(mutations(t), rng)
    .map((m) => ({ m, value: evaluateMutation(t, m, inst) }))
    .filter((c) => c.value != null)
  const usedRules = new Set<RuleId>()
  for (const c of candidates) if (!usedRules.has(c.m.rule) && tryAdd(c.value, c.m.rule, c.m.why)) usedRules.add(c.m.rule)
  for (const c of candidates) tryAdd(c.value, c.m.rule, c.m.why)
  for (const n of nearMisses(correct, f, rng)) tryAdd(n.value, 'near-miss', n.why)

  return shuffle([{ value: roundAnswer(correct, f), correct: true }, ...picked], rng)
}

// Which mistake a typed answer matches, if any: "you probably forgot to …".
export function diagnose(t: Pick<ProblemTemplate, 'answer' | 'derived' | 'vars' | 'answerFormat' | 'customDistractors'>, inst: Instance, given: number): { rule: RuleId; why: Explanation } | null {
  const f = t.answerFormat
  const r = roundAnswer(given, f)
  for (const c of t.customDistractors) {
    try {
      if (roundAnswer(evaluate(c.expr, inst.values), f) === r) return { rule: 'custom', why: { text: c.label } }
    } catch {
      // a custom formula that can't be evaluated here can't be what was typed
    }
  }
  for (const m of mutations(t)) {
    const v = evaluateMutation(t, m, inst)
    if (v != null && roundAnswer(v, f) === r && r !== roundAnswer(inst.answer, f)) return { rule: m.rule, why: m.why }
  }
  return null
}
