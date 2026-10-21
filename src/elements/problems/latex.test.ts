import { describe, expect, it } from 'vitest'
import type { MathJSON } from '../../types'
import { detectNumbers, suggestRange, suggestTitle } from './authoring'
import { generateMany } from './engine'
import { parse, ParseError, toLatex } from './latex'
import { evaluate, test } from './mathjson'
import { asTemplate, SAMPLES } from './samples'

describe('reading LaTeX from the math field', () => {
  it.each<[string, MathJSON]>([
    ['\\frac{d}{t}', ['Divide', 'd', 't']],
    ['d/t', ['Divide', 'd', 't']],
    ['\\frac12mv^2', ['Multiply', ['Divide', 1, 2], 'm', ['Power', 'v', 2]]],
    ['\\frac{1}{2}m v^{2}', ['Multiply', ['Divide', 1, 2], 'm', ['Power', 'v', 2]]],
    ['\\sqrt{a^2+b^2}', ['Sqrt', ['Add', ['Power', 'a', 2], ['Power', 'b', 2]]]],
    ['\\sqrt[3]{x}', ['Root', 'x', 3]],
    ['a-b+c', ['Add', 'a', ['Negate', 'b'], 'c']],
    ['-x^2', ['Negate', ['Power', 'x', 2]]],
    ['2\\left(a+b\\right)', ['Multiply', 2, ['Add', 'a', 'b']]],
    ['p\\cdot\\left(1-\\frac{r}{100}\\right)', ['Multiply', 'p', ['Add', 1, ['Negate', ['Divide', 'r', 100]]]]],
    ['\\pi r^2', ['Multiply', 'Pi', ['Power', 'r', 2]]],
    ['v_0+at', ['Add', 'v_0', ['Multiply', 'a', 't']]],
    ['v_{0}t', ['Multiply', 'v_0', 't']],
    ['\\sin\\left(2\\theta\\right)', ['Sin', ['Multiply', 2, 'theta']]],
    ['\\sin 2\\theta', ['Sin', ['Multiply', 2, 'theta']]],
    ['\\sin^2x', ['Power', ['Sin', 'x'], 2]],
    ['\\log_{2}8', ['Log', 8, 2]],
    ['\\ln x', ['Ln', 'x']],
    ['e^{x}', ['Power', 'ExponentialE', 'x']],
    ['30^{\\circ}', ['Degrees', 30]],
    ['30\\degree', ['Degrees', 30]],
    ['\\left|x-3\\right|', ['Abs', ['Add', 'x', -3]]],
    ['2|x|', ['Multiply', 2, ['Abs', 'x']]],
    ['\\max\\left(a,b\\right)', ['Max', 'a', 'b']],
    ['2{,}5x', ['Multiply', 2.5, 'x']],
    ['b^2-4ac\\ge0', ['GreaterEqual', ['Add', ['Power', 'b', 2], ['Negate', ['Multiply', 4, 'a', 'c']]], 0]],
    ['0<a\\le10', ['And', ['Less', 0, 'a'], ['LessEqual', 'a', 10]]],
    ['\\mathrm{rate}\\cdot t', ['Multiply', 'rate', 't']],
    ['x\\%', ['Divide', 'x', 100]],
    ['3·4−1', ['Add', ['Multiply', 3, 4], -1]],
  ])('%s', (latex, json) => {
    expect(parse(latex)).toEqual(json)
  })

  it('reads "e" as a variable only when there is one called e', () => {
    expect(parse('e', { names: ['e'] })).toBe('e')
    expect(parse('e')).toBe('ExponentialE')
  })

  it.each([
    ['', 'empty'],
    ['\\frac{a}{', 'missing'],
    ['(a+b', 'isn’t closed'],
    ['a+b)', 'too many'],
    ['\\foo{x}', 'isn’t supported'],
    ['a\\pm b', 'two answers'],
  ])('explains what it can’t read: %s', (latex, message) => {
    expect(() => parse(latex)).toThrow(ParseError)
    expect(() => parse(latex)).toThrow(message)
  })
})

describe('writing LaTeX', () => {
  it('writes readable formulas', () => {
    expect(toLatex(['Divide', 'd', 't'])).toBe('\\frac{d}{t}')
    expect(toLatex(['Multiply', ['Rational', 1, 2], 'm', ['Power', 'v', 2]])).toBe('\\frac{1}{2} m v^{2}')
    expect(toLatex(['Add', 'a', ['Negate', 'b']])).toBe('a - b')
    expect(toLatex(['Multiply', 'p', ['Add', 1, ['Negate', 'r']]])).toBe('p \\left(1 - r\\right)')
    expect(toLatex(['Multiply', 'Pi', ['Square', 'r']])).toBe('\\pi r^{2}')
    expect(toLatex('v_0')).toBe('v_{0}')
    expect(toLatex('theta')).toBe('\\theta')
    expect(toLatex(['GreaterEqual', 'D', 0])).toBe('D \\ge 0')
  })

  it('puts numbers in, with brackets where a negative needs them', () => {
    expect(toLatex(['Multiply', 'a', 'b'], { values: { a: 2, b: -3 } })).toBe('2 \\left(-3\\right)')
    expect(toLatex(['Power', 'x', 2], { values: { x: -4 } })).toBe('\\left(-4\\right)^{2}')
    expect(toLatex(['Add', 'a', 'b'], { values: { a: 2, b: -3 } })).toBe('2 - 3')
    expect(toLatex(['Divide', 'd', 't'], { values: { d: 2.5, t: 2 }, number: (n) => String(n).replace('.', '{,}') })).toBe('\\frac{2{,}5}{2}')
  })

  it.each(Object.entries(SAMPLES))('%s survives writing and reading back', (_, draft) => {
    const t = asTemplate(draft)
    const names = [...t.vars.map((v) => v.name), ...t.derived.map((d) => d.name)]
    const again = parse(toLatex(t.answer), { names })
    for (const inst of generateMany(t, 30)) expect(evaluate(again, inst.values)).toBeCloseTo(inst.answer, 9)
    for (const c of t.constraints) {
      const back = parse(toLatex(c), { names })
      for (const inst of generateMany(t, 10)) expect(test(back, inst.values)).toBe(true)
    }
  })
})

describe('creating from an example', () => {
  it('turns numbers into variables named after their units', () => {
    const d = detectNumbers('A car travels 120 km in 2.5 h. What is its average speed?')
    expect(d.text).toBe('A car travels {d} km in {t} h. What is its average speed?')
    expect(d.vars.map(({ name, unit, original, source }) => ({ name, unit, original, source }))).toEqual([
      { name: 'd', unit: 'km', original: 120, source: { kind: 'range', min: 60, max: 240, step: 5 } },
      { name: 't', unit: 'h', original: 2.5, source: { kind: 'range', min: 1.3, max: 5, step: 0.1 } },
    ])
  })

  it('falls back to a, b, c and keeps names unique', () => {
    const d = detectNumbers('Add 3 and 4, then 5 km and 6 km.')
    expect(d.vars.map((v) => v.name)).toEqual(['a', 'b', 'd', 'd_2'])
  })

  it('reads the decimal comma, currency in front, and negative numbers', () => {
    const d = detectNumbers('Il prezzo è €1.250,50 e la temperatura -3 °C, non 5-3.', ',')
    expect(d.vars.map((v) => [v.name, v.original])).toEqual([
      ['p', 1250.5],
      ['T', -3],
      ['a', 5],
      ['b', 3],
    ])
  })

  it('ignores digits inside words', () => {
    expect(detectNumbers('CO2 and x2 stay; 7 goes.').vars.map((v) => v.original)).toEqual([7])
  })

  it('suggests ranges with the same decimal places, about half to double', () => {
    expect(suggestRange(120)).toEqual({ min: 60, max: 240, step: 5 })
    expect(suggestRange(7)).toEqual({ min: 4, max: 14, step: 1 })
    expect(suggestRange(0.25)).toEqual({ min: 0.13, max: 0.5, step: 0.01 })
    expect(suggestRange(-8)).toEqual({ min: -16, max: -4, step: 1 })
    expect(suggestRange(4500)).toEqual({ min: 2300, max: 9000, step: 100 })
  })

  it('suggests the question as the title, or else the first words', () => {
    expect(suggestTitle('A car travels {d} km in {t} h. What is its average speed?')).toBe('What is its average speed?')
    expect(suggestTitle('A car travels {d} km in {t} h, so how fast does it go on average?')).toBe('A car travels … km in … h, so…')
  })
})
