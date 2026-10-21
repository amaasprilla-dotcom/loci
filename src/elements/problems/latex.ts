// LaTeX ⇄ MathJSON for problem formulas. MathLive's math field gives LaTeX as the
// user types (\frac{d}{t}, \sqrt{a^2+b^2}, \sin\left(2\theta\right)…); parse()
// turns it into MathJSON for the engine, and toLatex() writes MathJSON back for
// the math field and for KaTeX. Sums come out as ["Add", a, ["Negate", b]] and
// products as one n-ary ["Multiply", …], the shapes the wrong-answer rules work on.

import type { MathJSON } from '../../types'
import { headOf, isCall, numberValue } from './mathjson'

export class ParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseError'
  }
}

const GREEK = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi',
  'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Sigma', 'Phi', 'Psi', 'Omega',
]
const GREEK_CHARS: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', θ: 'theta', λ: 'lambda', μ: 'mu', ρ: 'rho', σ: 'sigma', τ: 'tau', φ: 'phi', ω: 'omega', Δ: 'Delta', Ω: 'Omega',
}

const FUNCTIONS: Record<string, string> = {
  sin: 'Sin', cos: 'Cos', tan: 'Tan', cot: 'Cot', sec: 'Sec', csc: 'Csc',
  arcsin: 'Arcsin', arccos: 'Arccos', arctan: 'Arctan', sinh: 'Sinh', cosh: 'Cosh', tanh: 'Tanh',
  ln: 'Ln', log: 'Log', lg: 'Lg', lb: 'Lb', exp: 'Exp', max: 'Max', min: 'Min',
  abs: 'Abs', floor: 'Floor', ceil: 'Ceil', round: 'Round', mod: 'Mod',
}

const RELATIONS: Record<string, string> = {
  '=': 'Equal', '<': 'Less', '>': 'Greater', '\\lt': 'Less', '\\gt': 'Greater',
  '\\le': 'LessEqual', '\\leq': 'LessEqual', '\\leqslant': 'LessEqual', '≤': 'LessEqual',
  '\\ge': 'GreaterEqual', '\\geq': 'GreaterEqual', '\\geqslant': 'GreaterEqual', '≥': 'GreaterEqual',
  '\\ne': 'NotEqual', '\\neq': 'NotEqual', '≠': 'NotEqual',
}

const SPACES = new Set(['\\,', '\\;', '\\:', '\\!', '\\ ', '\\quad', '\\qquad', '~', '\\displaystyle', '\\left.', '\\right.'])

type Token = { kind: 'num'; value: string } | { kind: 'cmd'; name: string } | { kind: 'char'; ch: string }

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(src[i + 1] ?? ''))) {
      // Digits, with "." or MathLive's "{,}" as the decimal separator.
      let value = ''
      while (i < src.length) {
        if (/\d/.test(src[i])) value += src[i++]
        else if (src[i] === '.' && !value.includes('.') && /\d/.test(src[i + 1] ?? '')) value += src[i++]
        else if (src.startsWith('{,}', i) && !value.includes('.') && /\d/.test(src[i + 3] ?? '')) {
          value += '.'
          i += 3
        } else break
      }
      tokens.push({ kind: 'num', value })
      continue
    }
    if (ch === '\\') {
      const word = /^\\([A-Za-z]+)/.exec(src.slice(i))
      const name = word ? `\\${word[1]}` : src.slice(i, i + 2)
      i += name.length
      if (name === '\\left' || name === '\\right') {
        // \left( … \right): keep the delimiter, drop the sizing.
        const next = /^\s*(\\[A-Za-z]+|\\.|.)/.exec(src.slice(i))
        if (!next) continue
        i += next[0].length
        const delim = next[1]
        if (delim === '.') continue
        if (delim === '\\{' || delim === '\\}' || delim === '\\vert' || delim === '\\lvert' || delim === '\\rvert' || delim === '\\lfloor' || delim === '\\rfloor' || delim === '\\lceil' || delim === '\\rceil') {
          tokens.push(delim.startsWith('\\l') || delim.startsWith('\\r') ? { kind: 'cmd', name: delim } : { kind: 'char', ch: delim === '\\{' ? '(' : delim === '\\}' ? ')' : '|' })
        } else tokens.push({ kind: 'char', ch: delim === '[' ? '(' : delim === ']' ? ')' : delim })
        continue
      }
      if (SPACES.has(name)) continue
      tokens.push({ kind: 'cmd', name })
      continue
    }
    if (GREEK_CHARS[ch]) {
      tokens.push({ kind: 'cmd', name: `\\${GREEK_CHARS[ch]}` })
      i++
      continue
    }
    const map: Record<string, string> = { '·': '\\cdot', '×': '\\times', '÷': '\\div', '−': '-', π: '\\pi', '√': '\\sqrt', '°': '\\degree' }
    if (map[ch]) {
      const m = map[ch]
      tokens.push(m.startsWith('\\') ? { kind: 'cmd', name: m } : { kind: 'char', ch: m })
      i++
      continue
    }
    tokens.push({ kind: 'char', ch })
    i++
  }
  return tokens
}

export interface ParseOptions {
  // Variables the template defines; "e" means Euler's number unless it's one of them.
  names?: Iterable<string>
}

// LaTeX (or plain typing like "d/t") → MathJSON. Throws ParseError.
export function parse(latex: string, options: ParseOptions = {}): MathJSON {
  const names = new Set(options.names ?? [])
  const tokens = tokenize(latex)
  let pos = 0
  let absDepth = 0 // inside |…|, a "|" closes instead of opening

  const peek = () => tokens[pos]
  const isChar = (ch: string, t = peek()) => t?.kind === 'char' && t.ch === ch
  const isCmd = (name: string, t = peek()) => t?.kind === 'cmd' && t.name === name
  const expectChar = (ch: string) => {
    if (!isChar(ch)) throw new ParseError(ch === '}' || ch === ')' ? 'A bracket isn’t closed.' : `Expected “${ch}”.`)
    pos++
  }

  function relation(): MathJSON {
    const first = sum()
    const parts: MathJSON[] = [first]
    let head: string | null = null
    for (;;) {
      const t = peek()
      const op = t && (t.kind === 'char' ? RELATIONS[t.ch] : t.kind === 'cmd' ? RELATIONS[t.name] : undefined)
      if (!op) break
      if (head && op !== head) {
        // a < b ≤ c: two comparisons joined by And.
        pos++
        const right = sum()
        return ['And', [head, ...parts] as MathJSON, [op, parts[parts.length - 1], right]]
      }
      head = op
      pos++
      parts.push(sum())
    }
    return head ? ([head, ...parts] as MathJSON) : first
  }

  function sum(): MathJSON {
    const terms: MathJSON[] = []
    let sign = 1
    if (isChar('+')) pos++
    else if (isChar('-')) {
      pos++
      sign = -1
    }
    for (;;) {
      const t = product()
      terms.push(sign < 0 ? negate(t) : t)
      if (isChar('+')) sign = 1
      else if (isChar('-')) sign = -1
      else if (isCmd('\\pm')) throw new ParseError('± gives two answers; write one of them.')
      else break
      pos++
    }
    return terms.length === 1 ? terms[0] : ['Add', ...terms]
  }

  // Factors, multiplied (·, ×, *, or side by side) or divided (/, ÷).
  function product(): MathJSON {
    let factors: MathJSON[] = [unary()]
    for (;;) {
      if (isCmd('\\cdot') || isCmd('\\times') || isChar('*')) {
        pos++
        factors.push(unary())
      } else if (isChar('/') || isCmd('\\div')) {
        pos++
        const left = factors.length === 1 ? factors[0] : (['Multiply', ...factors] as MathJSON)
        factors = [['Divide', left, unary()]]
      } else if (startsFactor()) factors.push(power())
      else break
    }
    return factors.length === 1 ? factors[0] : ['Multiply', ...factors]
  }

  function unary(): MathJSON {
    if (isChar('-')) {
      pos++
      return negate(unary())
    }
    if (isChar('+')) {
      pos++
      return unary()
    }
    return power()
  }

  function startsFactor(): boolean {
    const t = peek()
    if (!t) return false
    if (t.kind === 'num') return true
    if (t.kind === 'char') return /[A-Za-z(]/.test(t.ch) || t.ch === '{' || (t.ch === '|' && absDepth === 0)
    if (RELATIONS[t.name] || t.name === '\\cdot' || t.name === '\\times' || t.name === '\\div' || t.name === '\\pm') return false
    return !['\\rfloor', '\\rceil', '\\right'].includes(t.name)
  }

  function power(): MathJSON {
    let base = postfix(primary())
    while (isChar('^')) {
      pos++
      if (isCmd('\\circ')) {
        pos++
        base = ['Degrees', base]
        continue
      }
      if (isChar('{') && isCmd('\\circ', tokens[pos + 1]) && isChar('}', tokens[pos + 2])) {
        pos += 3
        base = ['Degrees', base]
        continue
      }
      const exp = group()
      if (isCall(exp) && exp[0] === 'Degrees' && exp[1] === 1) base = ['Degrees', base]
      else base = ['Power', base, exp]
    }
    return postfix(base)
  }

  function postfix(e: MathJSON): MathJSON {
    for (;;) {
      if (isCmd('\\degree')) {
        pos++
        e = ['Degrees', e]
      } else if (isCmd('\\%')) {
        pos++
        e = ['Divide', e, 100]
      } else if (isChar('!')) throw new ParseError('Factorials aren’t supported.')
      else return e
    }
  }

  // An argument in braces, or a single token (x^2, \frac12).
  function group(): MathJSON {
    if (isChar('{')) {
      pos++
      const e = relation()
      expectChar('}')
      return e
    }
    const t = peek()
    if (!t) throw new ParseError('Something is missing at the end.')
    if (t.kind === 'num') {
      // \frac12 means \frac{1}{2}: a bare group takes one digit.
      pos++
      if (t.value.length > 1 && !t.value.includes('.')) {
        tokens.splice(pos, 0, { kind: 'num', value: t.value.slice(1) })
        return Number(t.value[0])
      }
      return Number(t.value)
    }
    return primary()
  }

  function nameAfter(base: string): string {
    // Subscripts become part of the name: v_0 → "v_0", x_{ab} → "x_ab".
    if (!isChar('_')) return base
    pos++
    let sub = ''
    if (isChar('{')) {
      pos++
      while (peek() && !isChar('}')) {
        const t = tokens[pos++]
        sub += t.kind === 'num' ? t.value : t.kind === 'char' ? t.ch : t.name.replace('\\', '')
      }
      expectChar('}')
    } else {
      const t = tokens[pos++]
      if (!t) throw new ParseError('A subscript is empty.')
      sub = t.kind === 'num' ? t.value[0] : t.kind === 'char' ? t.ch : t.name.replace('\\', '')
      if (t.kind === 'num' && t.value.length > 1) tokens.splice(pos, 0, { kind: 'num', value: t.value.slice(1) })
    }
    if (!/^[A-Za-z0-9]+$/.test(sub)) throw new ParseError('Subscripts can only be letters and digits.')
    return `${base}_${sub}`
  }

  function symbol(name: string): MathJSON {
    if (name === 'e' && !names.has('e')) return 'ExponentialE'
    return name
  }

  // A function's argument: (a, b) in brackets, or the factors right after it (\sin 2x).
  function functionArgs(): MathJSON[] {
    if (isChar('(')) {
      pos++
      const args = [relation()]
      while (isChar(',')) {
        pos++
        args.push(relation())
      }
      expectChar(')')
      return args
    }
    if (isChar('{')) return [group()]
    const factors = [power()]
    while (peek()?.kind === 'num' || (peek()?.kind === 'char' && /[A-Za-z]/.test((peek() as { ch: string }).ch)) || (peek()?.kind === 'cmd' && GREEK.includes((peek() as { name: string }).name.slice(1)))) factors.push(power())
    return [factors.length === 1 ? factors[0] : ['Multiply', ...factors]]
  }

  function applyFunction(fname: string): MathJSON {
    const head = FUNCTIONS[fname]
    if (!head) throw new ParseError(`“${fname}” isn’t a function this app knows.`)
    let base: MathJSON | null = null
    if (head === 'Log' && isChar('_')) {
      pos++
      base = group()
    }
    let exponent: MathJSON | null = null
    if (isChar('^')) {
      // \sin^2 x = (sin x)²
      pos++
      exponent = group()
    }
    const args = functionArgs()
    let call: MathJSON = base != null ? ['Log', args[0], base] : ([head, ...args] as MathJSON)
    if (head === 'Exp' && args.length !== 1) throw new ParseError('exp takes one value.')
    if (exponent != null) call = ['Power', call, exponent]
    return call
  }

  function primary(): MathJSON {
    const t = peek()
    if (!t) throw new ParseError('Something is missing at the end.')
    pos++
    if (t.kind === 'num') return Number(t.value)
    if (t.kind === 'char') {
      if (/[A-Za-z]/.test(t.ch)) return symbol(nameAfter(t.ch))
      if (t.ch === '(') {
        const e = relation()
        expectChar(')')
        return e
      }
      if (t.ch === '{') {
        const e = relation()
        expectChar('}')
        return e
      }
      if (t.ch === '|') {
        absDepth++
        const e = sum()
        absDepth--
        expectChar('|')
        return ['Abs', e]
      }
      throw new ParseError(`“${t.ch}” can’t go there.`)
    }
    const name = t.name
    switch (name) {
      case '\\frac':
      case '\\dfrac':
      case '\\tfrac': {
        const n = group()
        const d = group()
        return ['Divide', n, d]
      }
      case '\\sqrt': {
        if (isChar('[')) {
          pos++
          const n = sum()
          expectChar(']')
          return ['Root', group(), n]
        }
        return ['Sqrt', group()]
      }
      case '\\pi':
        return 'Pi'
      case '\\exponentialE':
        return 'ExponentialE'
      case '\\infty':
        throw new ParseError('Infinity can’t be used in a formula.')
      case '\\mathrm':
      case '\\mathit':
      case '\\operatorname':
      case '\\text':
      case '\\textrm': {
        expectChar('{')
        let word = ''
        while (peek() && !isChar('}')) {
          const w = tokens[pos++]
          word += w.kind === 'num' ? w.value : w.kind === 'char' ? w.ch : w.name.replace('\\', '')
        }
        expectChar('}')
        word = word.trim()
        if (FUNCTIONS[word] && (isChar('(') || name === '\\operatorname')) return applyFunction(word)
        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(word)) throw new ParseError(`“${word}” isn’t a usable name.`)
        return symbol(nameAfter(word))
      }
      case '\\lfloor': {
        const e = sum()
        if (!isCmd('\\rfloor')) throw new ParseError('⌊ isn’t closed.')
        pos++
        return ['Floor', e]
      }
      case '\\lceil': {
        const e = sum()
        if (!isCmd('\\rceil')) throw new ParseError('⌈ isn’t closed.')
        pos++
        return ['Ceil', e]
      }
      case '\\vert':
      case '\\lvert': {
        const e = sum()
        if (!(isChar('|') || isCmd('\\vert') || isCmd('\\rvert'))) throw new ParseError('| isn’t closed.')
        pos++
        return ['Abs', e]
      }
    }
    const word = name.slice(1)
    if (GREEK.includes(word)) return symbol(nameAfter(word))
    if (FUNCTIONS[word]) return applyFunction(word)
    throw new ParseError(`“${name}” isn’t supported in formulas.`)
  }

  if (tokens.length === 0) throw new ParseError('The formula is empty.')
  const result = relation()
  if (pos < tokens.length) {
    const t = tokens[pos]
    throw new ParseError(t.kind === 'char' && (t.ch === ')' || t.ch === '}') ? 'There’s a closing bracket too many.' : 'Part of the formula couldn’t be read.')
  }
  return result
}

function negate(e: MathJSON): MathJSON {
  const n = numberValue(e)
  if (n != null && typeof e === 'number') return -n
  return ['Negate', e]
}

// ---------- MathJSON → LaTeX ----------

export interface LatexOptions {
  // Put these numbers in place of the variables (a worked answer).
  values?: Record<string, number>
  // Format a number; by default as JavaScript writes it.
  number?: (n: number) => string
}

// Binding strength, to know where brackets are needed.
const PREC = { relation: 1, sum: 2, product: 3, unary: 4, power: 5, atom: 6 }

export function nameToLatex(name: string): string {
  const [base, sub] = name.split('_', 2)
  const b = GREEK.includes(base) ? `\\${base}` : base.length === 1 ? base : `\\mathrm{${base}}`
  return sub ? `${b}_{${sub}}` : b
}

export function toLatex(expr: MathJSON, options: LatexOptions = {}): string {
  const fmtNumber = (n: number) => {
    const s = options.number ? options.number(Math.abs(n)) : String(Math.abs(n))
    return n < 0 ? `-${s}` : s
  }

  // [latex, precedence]
  function go(e: MathJSON): [string, number] {
    const n = typeof e === 'number' || (typeof e === 'object' && !Array.isArray(e)) ? numberValue(e) : null
    if (n != null) return [fmtNumber(n), n < 0 ? PREC.unary : PREC.atom]
    if (typeof e === 'string') {
      if (options.values && e in options.values) {
        const v = options.values[e]
        return [fmtNumber(v), v < 0 ? PREC.unary : PREC.atom]
      }
      if (e === 'Pi') return ['\\pi', PREC.atom]
      if (e === 'ExponentialE') return ['e', PREC.atom]
      if (e === 'Half') return ['\\frac{1}{2}', PREC.atom]
      return [nameToLatex(e), PREC.atom]
    }
    if (!isCall(e)) return ['?', PREC.atom]
    const [head, ...args] = e
    const wrap = (a: MathJSON, min: number) => {
      const [s, p] = go(a)
      return p < min ? `\\left(${s}\\right)` : s
    }
    const fn = (cmd: string) => [`${cmd}\\left(${args.map((a) => go(a)[0]).join(', ')}\\right)`, PREC.atom] as [string, number]
    switch (head) {
      case 'Add': {
        let out = ''
        args.forEach((a, i) => {
          if (i > 0 && headOf(a) === 'Negate') out += ` - ${wrap((a as MathJSON[])[1], PREC.product)}`
          else if (i > 0 && typeof a === 'number' && a < 0) out += ` - ${fmtNumber(-a)}`
          else if (i > 0) {
            const s = wrap(a, PREC.product)
            out += s.startsWith('-') ? ` - ${s.slice(1)}` : ` + ${s}`
          } else out += wrap(a, PREC.sum)
        })
        return [out, PREC.sum]
      }
      case 'Subtract':
        if (args.length === 1) return [`-${wrap(args[0], PREC.power)}`, PREC.unary]
        return [args.map((a, i) => (i === 0 ? wrap(a, PREC.sum) : wrap(a, PREC.product))).join(' - '), PREC.sum]
      case 'Negate':
        // -(-9), not --9.
        return [`-${wrap(args[0], typeof args[0] === 'string' && options.values && args[0] in options.values ? PREC.atom : PREC.product)}`, PREC.unary]
      case 'Multiply': {
        // Side by side (2mv), except before a number, which needs a dot: 2 · 3, not 23.
        const parts = args.map((a, i) => wrap(a, i === 0 ? PREC.unary : PREC.power))
        return [parts.reduce((out, s) => (/^[\d.-]/.test(s) ? `${out} \\cdot ${s}` : `${out} ${s}`)), PREC.product]
      }
      case 'Divide':
        return [`\\frac{${go(args[0])[0]}}{${go(args[1])[0]}}`, PREC.atom]
      case 'Rational':
        return [`\\frac{${go(args[0])[0]}}{${go(args[1])[0]}}`, PREC.atom]
      case 'Half':
        return [`\\frac{${go(args[0])[0]}}{2}`, PREC.atom]
      case 'Power':
        return [`${wrap(args[0], PREC.atom)}^{${go(args[1])[0]}}`, PREC.power]
      case 'Square':
        return [`${wrap(args[0], PREC.atom)}^{2}`, PREC.power]
      case 'Sqrt':
        return [`\\sqrt{${go(args[0])[0]}}`, PREC.atom]
      case 'Root':
        return [`\\sqrt[${go(args[1])[0]}]{${go(args[0])[0]}}`, PREC.atom]
      case 'Exp':
        return [`e^{${go(args[0])[0]}}`, PREC.power]
      case 'Log':
        return args.length === 2 ? [`\\log_{${go(args[1])[0]}}\\left(${go(args[0])[0]}\\right)`, PREC.atom] : fn('\\log')
      case 'Lg':
        return fn('\\lg')
      case 'Lb':
        return fn('\\operatorname{lb}')
      case 'Abs':
        return [`\\left|${go(args[0])[0]}\\right|`, PREC.atom]
      case 'Floor':
        return [`\\left\\lfloor ${go(args[0])[0]}\\right\\rfloor`, PREC.atom]
      case 'Ceil':
      case 'Ceiling':
        return [`\\left\\lceil ${go(args[0])[0]}\\right\\rceil`, PREC.atom]
      case 'Round':
        return fn('\\operatorname{round}')
      case 'Mod':
        return fn('\\operatorname{mod}')
      case 'Degrees':
        return [`${wrap(args[0], PREC.atom)}^{\\circ}`, PREC.power]
      case 'Delimiter':
        return [`\\left(${go(isCall(args[0]) && args[0][0] === 'Sequence' ? args[0][1] : args[0])[0]}\\right)`, PREC.atom]
      case 'And':
        return [args.map((a) => wrap(a, PREC.relation + 1)).join(' \\land '), PREC.relation]
      case 'Or':
        return [args.map((a) => wrap(a, PREC.relation + 1)).join(' \\lor '), PREC.relation]
      case 'Not':
        return [`\\lnot ${wrap(args[0], PREC.atom)}`, PREC.unary]
    }
    const rel = { Equal: '=', NotEqual: '\\ne', Less: '<', LessEqual: '\\le', Greater: '>', GreaterEqual: '\\ge' }[head]
    if (rel) return [args.map((a) => go(a)[0]).join(` ${rel} `), PREC.relation]
    const lower = Object.entries(FUNCTIONS).find(([, h]) => h === head)?.[0]
    if (lower) return fn(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'ln', 'exp', 'max', 'min'].includes(lower) ? `\\${lower}` : `\\operatorname{${lower}}`)
    return [`\\operatorname{${head}}\\left(${args.map((a) => go(a)[0]).join(', ')}\\right)`, PREC.atom]
  }
  return go(expr)[0]
}
