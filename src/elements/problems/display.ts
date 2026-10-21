// Showing problems: questions with their numbers, answers in the template's
// format, and formulas with KaTeX.

import katex from 'katex'
import 'katex/dist/katex.min.css'
import { h } from '../../dom'
import { formatNumber, separators } from '../../locale'
import type { AnswerFormat, MathJSON } from '../../types'
import { answerFormatOptions, type Instance, roundAnswer } from './engine'
import { toLatex } from './latex'

// A variable's value as it appears in a question: as many decimals as it has.
export function formatValue(x: number): string {
  return formatNumber(x, { maximumFractionDigits: 10 })
}

// "48.0 km/h": rounded and shaped by the template's answer format.
export function formatAnswer(x: number, f: AnswerFormat): string {
  const n = formatNumber(roundAnswer(x, f), answerFormatOptions(f))
  return f.unit ? `${n} ${f.unit}` : n
}

// The question, with each number set in bold. A negative number right after
// "+" or "−" takes over the sign: "4x² + {b}x" with b = −9 reads "4x² − 9x".
export function questionNode(inst: Pick<Instance, 'question' | 'values'>): HTMLElement {
  const nodes: (string | HTMLElement)[] = []
  for (const part of inst.question) {
    if (typeof part === 'string') {
      nodes.push(part)
      continue
    }
    let value = inst.values[part.var]
    if (value == null) {
      nodes.push(`{${part.var}}`)
      continue
    }
    const prev = nodes[nodes.length - 1]
    if (value < 0 && typeof prev === 'string' && /[+\-−]\s*$/.test(prev)) {
      const sign = /\+\s*$/.test(prev) ? '−' : '+'
      nodes[nodes.length - 1] = prev.replace(/[+\-−](\s*)$/, `${sign}$1`)
      value = -value
    }
    nodes.push(h('strong', { class: 'problem-value' }, formatValue(value)))
  }
  return h('p', { class: 'problem-question' }, nodes)
}

// Numbers in LaTeX with this device's decimal separator.
export function latexNumber(n: number): string {
  const s = formatNumber(n, { maximumFractionDigits: 10, useGrouping: false })
  return separators().decimal === ',' ? s.replace(',', '{,}') : s
}

export function mathNode(latex: string, display = false): HTMLElement {
  const span = h('span', { class: display ? 'math-display' : 'math-inline' })
  // KaTeX escapes what it renders; trust stays off, so no links or HTML from the formula.
  span.innerHTML = katex.renderToString(latex, { throwOnError: false, displayMode: display })
  return span
}

export function formulaNode(expr: MathJSON, values?: Record<string, number>, display = false): HTMLElement {
  return mathNode(toLatex(expr, { values, number: latexNumber }), display)
}
