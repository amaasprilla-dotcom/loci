// The problem engine, formula mode (SPEC-v2.md, "Number generation"): pick
// numbers for a template's variables from a seed, compute derived values and the
// answer, and keep only numbers that pass the constraints. The same seed always
// gives the same instance, so any attempt can be replayed.

import seedrandom from 'seedrandom'
import type { AnswerFormat, MathJSON, ProblemTemplate, VarSpec } from '../../types'
import { CONSTANTS, evaluate, isCondition, MathError, type Scope, symbolsOf, test } from './mathjson'

export const MAX_TRIES = 200
export const DEFAULT_SIG_FIGS = 3

export type Rng = () => number

// A part of a question: plain text, or a variable whose value goes there.
export type QuestionPart = string | { var: string }

export interface Instance {
  seed: string
  values: Scope // every variable and derived value
  answer: number // exact; round with roundAnswer() to show or compare
  wording: number // which of the template's texts
  question: QuestionPart[]
}

export type Generated = { ok: true; instance: Instance } | { ok: false; reason: 'too-tight' | 'relation-mode' }

export function newSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function rngFor(seed: string): Rng {
  return seedrandom(seed)
}

// ---------- Variables ----------

export function decimalsOf(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0
  const s = String(n)
  const exp = /e-(\d+)$/.exec(s)
  if (exp) {
    const mantissa = s.split('e')[0]
    return Number(exp[1]) + (mantissa.split('.')[1]?.length ?? 0)
  }
  return s.split('.')[1]?.length ?? 0
}

export const roundTo = (x: number, decimals: number) => Number(x.toFixed(Math.min(20, Math.max(0, decimals))))

// How many values a range has: min, min + step, … up to max.
export function rangeCount(min: number, max: number, step: number): number {
  return Math.floor((max - min) / step + 1e-9) + 1
}

const excluded = (spec: VarSpec, x: number) => (spec.exclude ?? []).some((e) => Math.abs(e - x) < 1e-9)

// Every value a variable can take, when there are few enough to list (else null).
export function possibleValues(spec: VarSpec, limit = 10_000): number[] | null {
  if (spec.source.kind === 'list') return spec.source.values.filter((x) => !excluded(spec, x))
  const { min, max, step } = spec.source
  const count = rangeCount(min, max, step)
  if (count > limit) return null
  const dec = Math.max(decimalsOf(min), decimalsOf(step))
  return Array.from({ length: count }, (_, k) => roundTo(min + k * step, dec)).filter((x) => !excluded(spec, x))
}

// One value for a variable. Ranges snap to their step: min 20, max 200, step 5
// gives 35, 120, 185…
export function sampleVar(spec: VarSpec, rng: Rng): number {
  for (let i = 0; i < 1000; i++) {
    let x: number
    if (spec.source.kind === 'list') {
      const { values } = spec.source
      x = values[Math.floor(rng() * values.length)]
    } else {
      const { min, max, step } = spec.source
      const k = Math.floor(rng() * rangeCount(min, max, step))
      x = roundTo(min + k * step, Math.max(decimalsOf(min), decimalsOf(step)))
    }
    if (!excluded(spec, x)) return x
  }
  // Nearly everything is excluded: take the first value that isn't.
  const allowed = possibleValues(spec)
  if (!allowed?.length) throw new MathError('malformed', `“${spec.name}” has no values left after exclusions`)
  return allowed[Math.floor(rng() * allowed.length)]
}

// ---------- Wordings ----------

// "{Find|Calculate} the speed after {d} km" → text, alternatives and variables.
export type Segment = { kind: 'text'; text: string } | { kind: 'var'; name: string } | { kind: 'alt'; options: string[] }

export function parseText(text: string): Segment[] {
  const segments: Segment[] = []
  const pushText = (s: string) => {
    const prev = segments[segments.length - 1]
    if (prev?.kind === 'text') prev.text += s
    else if (s) segments.push({ kind: 'text', text: s })
  }
  const re = /\{([^{}]*)\}/g
  let last = 0
  for (const m of text.matchAll(re)) {
    pushText(text.slice(last, m.index))
    const inner = m[1]
    if (inner.includes('|')) segments.push({ kind: 'alt', options: inner.split('|') })
    else if (inner.trim()) segments.push({ kind: 'var', name: inner.trim() })
    else pushText(m[0])
    last = m.index + m[0].length
  }
  pushText(text.slice(last))
  return segments
}

// One wording, with one alternative picked for each {a|b}.
export function pickQuestion(texts: string[], rng: Rng): { wording: number; question: QuestionPart[] } {
  const wording = Math.floor(rng() * texts.length)
  const question: QuestionPart[] = []
  const push = (s: string) => {
    if (typeof question[question.length - 1] === 'string') question[question.length - 1] += s
    else question.push(s)
  }
  for (const seg of parseText(texts[wording] ?? '')) {
    if (seg.kind === 'text') push(seg.text)
    else if (seg.kind === 'alt') push(seg.options[Math.floor(rng() * seg.options.length)])
    else question.push({ var: seg.name })
  }
  return { wording, question }
}

// ---------- Instances ----------

// Numbers that make a formula fail this way just mean "try other numbers".
const isRetryable = (e: unknown) => e instanceof MathError && (e.kind === 'divide-by-zero' || e.kind === 'not-real')

function finite(x: number): number {
  if (!Number.isFinite(x)) throw new MathError('not-real', 'Not a finite number')
  return x
}

// The values and answer for one set of variable values, or null when they break
// a constraint or a built-in rule (division by zero, not finite or not real).
export function solve(t: Pick<ProblemTemplate, 'derived' | 'answer' | 'constraints'>, vars: Scope): { values: Scope; answer: number } | null {
  const values: Scope = { ...vars }
  try {
    for (const d of t.derived) values[d.name] = finite(evaluate(d.expr, values))
    const answer = finite(evaluate(t.answer, values))
    if (!t.constraints.every((c) => test(c, values))) return null
    return { values, answer }
  } catch (e) {
    if (isRetryable(e)) return null
    throw e
  }
}

// One instance of the template from this seed: up to 200 tries at numbers that
// pass every constraint. Throws MathError for a broken template (see validate()).
export function generate(t: ProblemTemplate, seed: string = newSeed()): Generated {
  if (t.mode === 'relation') return { ok: false, reason: 'relation-mode' }
  const rng = rngFor(seed)
  for (let i = 0; i < MAX_TRIES; i++) {
    const vars: Scope = {}
    for (const v of t.vars) vars[v.name] = sampleVar(v, rng)
    const solved = solve(t, vars)
    if (!solved) continue
    return { ok: true, instance: { seed, ...solved, ...pickQuestion(t.texts, rng) } }
  }
  return { ok: false, reason: 'too-tight' }
}

// Several instances with different seeds, e.g. for the editor's preview.
export function generateMany(t: ProblemTemplate, count: number, seeds: string[] = []): Instance[] {
  const out: Instance[] = []
  for (let i = 0; i < count; i++) {
    const g = generate(t, seeds[i] ?? newSeed())
    if (!g.ok) break
    out.push(g.instance)
  }
  return out
}

// ---------- Answers ----------

const sigFigsOf = (f: AnswerFormat) => (f.decimals == null ? (f.sigFigs ?? DEFAULT_SIG_FIGS) : null)

// The answer as shown: to the template's decimals or significant figures.
export function roundAnswer(x: number, f: AnswerFormat): number {
  if (f.decimals != null) return roundTo(x, f.decimals)
  if (x === 0 || !Number.isFinite(x)) return x
  return Number(x.toPrecision(Math.min(21, Math.max(1, sigFigsOf(f)!))))
}

// The size of the last digit shown, e.g. 0.01 for 2 decimals, or 0.1 for 48.0 to 3 significant figures.
export function lastPlace(x: number, f: AnswerFormat): number {
  if (f.decimals != null) return 10 ** -f.decimals
  const r = roundAnswer(x, f)
  if (r === 0) return 10 ** -(sigFigsOf(f)! - 1)
  return 10 ** (Math.floor(Math.log10(Math.abs(r))) - sigFigsOf(f)! + 1)
}

// A typed answer counts as right when it's within one unit of the last digit
// shown, so rounding at a different step doesn't make it wrong.
export function isCorrect(given: number, answer: number, f: AnswerFormat): boolean {
  if (!Number.isFinite(given)) return false
  return Math.abs(given - answer) <= lastPlace(answer, f) * 1.0000001
}

// Options for Intl.NumberFormat that show every option in the same shape.
export function answerFormatOptions(f: AnswerFormat): Intl.NumberFormatOptions {
  if (f.decimals != null) return { minimumFractionDigits: f.decimals, maximumFractionDigits: f.decimals }
  const s = sigFigsOf(f)!
  return { minimumSignificantDigits: s, maximumSignificantDigits: s }
}

// ---------- Checking a template ----------

const NAME = /^[A-Za-zͰ-Ͽ][A-Za-z0-9_Ͱ-Ͽ]*$/

// What's wrong with a template, in words for the editor; empty when it's fine.
export function validate(t: Pick<ProblemTemplate, 'texts' | 'vars' | 'derived' | 'answer' | 'constraints' | 'answerFormat' | 'mode'>): string[] {
  const problems: string[] = []
  const known = new Set<string>()

  if (t.texts.every((s) => !s.trim())) problems.push('Write the problem’s text.')

  for (const v of t.vars) {
    if (!NAME.test(v.name)) problems.push(`“${v.name}” isn’t a usable name: start with a letter, then letters, digits or _.`)
    else if (v.name in CONSTANTS) problems.push(`“${v.name}” is a built-in constant; pick another name.`)
    else if (known.has(v.name)) problems.push(`Two variables are called “${v.name}”.`)
    known.add(v.name)
    const s = v.source
    if (s.kind === 'range') {
      if (![s.min, s.max, s.step].every(Number.isFinite)) problems.push(`“${v.name}” needs a minimum, a maximum and a step.`)
      else if (s.step <= 0) problems.push(`“${v.name}”: the step has to be more than 0.`)
      else if (s.min > s.max) problems.push(`“${v.name}”: the minimum is above the maximum.`)
      else if (possibleValues(v)?.length === 0) problems.push(`“${v.name}”: every value is excluded.`)
    } else if (s.values.length === 0 || !s.values.every(Number.isFinite)) problems.push(`“${v.name}” needs at least one value.`)
    else if (possibleValues(v)?.length === 0) problems.push(`“${v.name}”: every value is excluded.`)
  }

  const undefinedIn = (expr: MathJSON, what: string) => {
    const missing = [...symbolsOf(expr)].filter((s) => !known.has(s))
    if (missing.length) problems.push(`${what} uses ${missing.map((m) => `“${m}”`).join(', ')}, which ${missing.length === 1 ? 'isn’t a variable' : 'aren’t variables'}.`)
  }
  for (const d of t.derived) {
    if (!NAME.test(d.name) || d.name in CONSTANTS) problems.push(`“${d.name}” isn’t a usable name for a derived value.`)
    else if (known.has(d.name)) problems.push(`“${d.name}” is already taken.`)
    undefinedIn(d.expr, `“${d.name}”`)
    known.add(d.name)
  }
  if (t.mode === 'formula') undefinedIn(t.answer, 'The answer')
  t.constraints.forEach((c, i) => {
    if (!isCondition(c)) problems.push(`Constraint ${i + 1} has to compare two things, e.g. a > 0.`)
    undefinedIn(c, `Constraint ${i + 1}`)
  })

  for (const text of t.texts) {
    for (const seg of parseText(text)) if (seg.kind === 'var' && !known.has(seg.name)) problems.push(`The text mentions {${seg.name}}, which isn’t a variable.`)
  }

  const f = t.answerFormat
  if (f.decimals != null && !(Number.isInteger(f.decimals) && f.decimals >= 0 && f.decimals <= 10)) problems.push('Decimals go from 0 to 10.')
  if (f.sigFigs != null && !(Number.isInteger(f.sigFigs) && f.sigFigs >= 1 && f.sigFigs <= 15)) problems.push('Significant figures go from 1 to 15.')
  return [...new Set(problems)]
}

// Whether the constraints leave any numbers at all: false when several seeds in a
// row each fail 200 tries ("constraints too tight").
export function constraintsLeaveRoom(t: ProblemTemplate, seeds = 3): boolean {
  for (let i = 0; i < seeds; i++) if (generate(t, `check-${i}`).ok) return true
  return false
}
