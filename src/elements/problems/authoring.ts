// Create from an example (SPEC-v2.md, "Authoring flow"): find the numbers in a
// real problem, turn each into a variable with a suggested name and range.
// "A car travels 120 km in 2.5 h" → "A car travels {d} km in {t} h", with
// d from 60 to 240 (step 5) and t from 1.3 to 5 (step 0.1).

import type { VarSpec } from '../../types'
import { decimalsOf, roundTo } from './engine'

// Names suggested by the unit after a number (or the currency before it).
const UNIT_NAMES: [string, string[]][] = [
  ['a', ['m/s²', 'm/s^2', 'm/s2']],
  ['v', ['m/s', 'km/h', 'kph', 'mph', 'km/s']],
  ['d', ['km', 'm', 'cm', 'mm', 'mi', 'miles', 'mile', 'ft', 'feet', 'metres', 'meters', 'kilometres', 'kilometers']],
  ['t', ['h', 'hr', 'hrs', 'hour', 'hours', 's', 'sec', 'secs', 'second', 'seconds', 'min', 'mins', 'minute', 'minutes', 'ms']],
  ['m', ['kg', 'g', 'gram', 'grams', 'kilograms', 'tonnes']],
  ['F', ['N', 'kN']],
  ['E', ['J', 'kJ', 'kWh', 'cal', 'kcal']],
  ['P', ['W', 'kW', 'MW']],
  ['V', ['V', 'volts', 'volt', 'mV']],
  ['R', ['Ω', 'ohm', 'ohms', 'kΩ']],
  ['I', ['A', 'mA', 'amps', 'amperes']],
  ['T', ['°C', '°F', 'K']],
  ['theta', ['°', 'degrees', 'deg']],
  ['r', ['%', 'percent']],
  ['p', ['€', '$', '£', 'euros', 'euro', 'dollars', 'dollar', 'pounds']],
  ['n', ['years', 'year', 'times', 'people', 'items', 'days', 'weeks', 'months']],
]
const NAME_FOR_UNIT = new Map(UNIT_NAMES.flatMap(([name, units]) => units.map((u) => [u, name] as const)))
// Counting words suggest a name but aren't units.
const COUNT_WORDS = new Set(['years', 'year', 'times', 'people', 'items', 'days', 'weeks', 'months'])

export interface DetectedVar extends VarSpec {
  original: number // the number in the example
  literal: string // as written, to put back if the user keeps it fixed
}

export interface Detected {
  text: string // with {name} where each number was
  vars: DetectedVar[]
}

function numberPattern(decimal: '.' | ','): RegExp {
  const group = decimal === '.' ? ',' : '\\.'
  const dec = decimal === '.' ? '\\.' : ','
  // 1,234.5 / 1.234,5 / 120 / 2.5 / -3 ; not part of a word (CO2, x2).
  return new RegExp(`(?<![\\p{L}\\d_${dec}])([-−]?)(\\d{1,3}(?:${group}\\d{3})+(?:${dec}\\d+)?|\\d+(?:${dec}\\d+)?)(?![\\d])`, 'gu')
}

export function readNumber(s: string, decimal: '.' | ','): number {
  const group = decimal === '.' ? ',' : '.'
  return Number(s.replace('−', '-').split(group).join('').replace(decimal, '.'))
}

// A range around the example's number: same decimal places, roughly half to double.
export function suggestRange(x: number): { min: number; max: number; step: number } {
  if (x === 0) return { min: 0, max: 10, step: 1 }
  const dec = decimalsOf(x)
  const abs = Math.abs(x)
  const step = dec > 0 ? 10 ** -Math.min(dec, 6) : abs >= 1000 ? 10 ** (Math.floor(Math.log10(abs)) - 1) : abs >= 100 ? 5 : 1
  const lo = Math.min(x / 2, x * 2)
  const hi = Math.max(x / 2, x * 2)
  const sdec = Math.max(dec, decimalsOf(step))
  let min = roundTo(Math.ceil(lo / step - 1e-9) * step, sdec)
  const max = roundTo(Math.floor(hi / step + 1e-9) * step, sdec)
  if (x > 0 && min <= 0) min = step // a positive example stays positive
  return { min, max, step }
}

export function detectNumbers(example: string, decimal: '.' | ',' = '.'): Detected {
  const vars: DetectedVar[] = []
  const used = new Set<string>()
  const unique = (base: string) => {
    if (!used.has(base)) return base
    for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`
  }
  const nextLetter = () => 'abcdefghjkpqrsuwxyz'.split('').find((l) => !used.has(l)) ?? unique('x')

  let text = ''
  let last = 0
  for (const m of example.matchAll(numberPattern(decimal))) {
    const start = m.index
    // A minus counts only at the start or after a space or bracket: "5-3" isn't -3.
    let sign = m[1]
    if (sign && start > 0 && !/[\s(]/.test(example[start - 1])) sign = ''
    const literalStart = sign ? start : start + m[1].length
    const end = start + m[0].length
    const value = readNumber((sign ? '-' : '') + m[2], decimal)
    if (!Number.isFinite(value)) continue

    const after = /^\s?([^\s,;:!?()]+)/u.exec(example.slice(end))?.[1]?.replace(/\.$/, '')
    const before = example.slice(Math.max(0, literalStart - 1), literalStart)
    const unit = after && NAME_FOR_UNIT.has(after) ? after : NAME_FOR_UNIT.has(before) ? before : undefined
    const name = unique(unit ? NAME_FOR_UNIT.get(unit)! : nextLetter())
    used.add(name)

    text += example.slice(last, literalStart) + `{${name}}`
    last = end
    vars.push({
      name,
      ...(unit && !COUNT_WORDS.has(unit) && { unit }),
      source: { kind: 'range', ...suggestRange(value) },
      original: value,
      literal: example.slice(literalStart, end),
    })
  }
  text += example.slice(last)
  return { text, vars }
}

// A short title: the question itself when it has no numbers in it ("What is
// its average speed?"), else the first words.
export function suggestTitle(text: string): string {
  const sentences = text.trim().split(/(?<=[.?!])\s+/)
  const question = [...sentences].reverse().find((s) => !s.includes('{') && s.length <= 70 && s.length > 3)
  if (question) return question
  const plain = text.replace(/\{[^{}]*\}/g, '…').replace(/\s+/g, ' ').trim()
  const words = plain.split(' ').slice(0, 9).join(' ')
  return words.length < plain.length ? `${words.replace(/[,.;:…]+$/, '').trim()}…` : words
}
