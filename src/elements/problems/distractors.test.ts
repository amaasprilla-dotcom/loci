import { describe, expect, it } from 'vitest'
import type { MathJSON } from '../../types'
import { chooseOptions, diagnose, evaluateMutation, mutations, normalize, plausible, type RuleId } from './distractors'
import { generate, generateMany, type Instance, roundAnswer } from './engine'
import { asTemplate, SAMPLES } from './samples'

const t = (name: keyof typeof SAMPLES) => asTemplate(SAMPLES[name])
const exprs = (name: keyof typeof SAMPLES, rule: RuleId) => mutations(t(name)).filter((m) => m.rule === rule).map((m) => m.expr)
const instance = (name: keyof typeof SAMPLES, seed = 'fixed'): Instance => {
  const g = generate(t(name), seed)
  if (!g.ok) throw new Error('no instance')
  return g.instance
}

describe('mistake rules', () => {
  it('order of operations: added before multiplying, multiplied only part of the brackets', () => {
    const m = mutations({ answer: ['Add', 'a', ['Multiply', 'b', 'c']], derived: [], vars: [] }).filter((x) => x.rule === 'order')
    expect(m.map((x) => x.expr)).toContainEqual(['Multiply', ['Add', 'a', 'b'], 'c'])
    expect(exprs('discount', 'order')).toContainEqual(['Add', ['Multiply', 'p', 1], ['Negate', ['Divide', 'r', 100]]])
  })

  it('order of operations: divided only part of the top, multiplied by what should divide', () => {
    const quad = exprs('quadratic', 'order')
    const other = normalize((SAMPLES.quadratic.answer as MathJSON[])[2])
    expect(quad).toContainEqual(['Max', ['Add', ['Negate', 'b'], ['Divide', ['Sqrt', 'D'], ['Multiply', 2, 'a']]], other])
    expect(quad).toContainEqual(['Max', ['Multiply', ['Divide', ['Add', ['Negate', 'b'], ['Sqrt', 'D']], 2], 'a'], other])
  })

  it('dropped factor: ½mv² → mv²', () => {
    expect(exprs('kineticEnergy', 'dropped-factor')).toContainEqual(['Multiply', 'm', ['Power', 'v', 2]])
  })

  it('dropped term: √(a² + b²) → √(b²)', () => {
    expect(exprs('hypotenuse', 'dropped-term')).toContainEqual(['Sqrt', ['Power', 'b', 2]])
  })

  it('sign slip: 1 − r/100 → 1 + r/100', () => {
    expect(exprs('discount', 'sign')).toContainEqual(['Multiply', 'p', ['Add', 1, ['Divide', 'r', 100]]])
  })

  it('inverted ratio: d/t → t/d', () => {
    expect(exprs('speed', 'inverted')).toContainEqual(['Divide', 't', 'd'])
  })

  it('power slip: r² → 2r, √x → x', () => {
    expect(exprs('circleArea', 'power')).toContainEqual(['Multiply', 'Pi', ['Multiply', 2, 'r']])
    expect(exprs('hypotenuse', 'power')).toContainEqual(['Add', ['Power', 'a', 2], ['Power', 'b', 2]])
  })

  it('wrong variable: two quantities in the same unit swapped', () => {
    expect(exprs('rectangle', 'wrong-variable')).toContainEqual(['Add', ['Divide', 'w', 2], ['Negate', 'w']])
  })

  it('unit slip: km taken as m, hours as minutes', () => {
    const units = exprs('speed', 'unit')
    expect(units).toContainEqual(['Divide', ['Multiply', 'd', 1000], 't'])
    expect(units).toContainEqual(['Divide', 'd', ['Multiply', 't', 60]])
  })

  it('a mistake in a derived value carries through to the answer', () => {
    const tpl = t('rectangle')
    const m = mutations(tpl).find((x) => x.target === 0 && x.rule === 'sign' && JSON.stringify(x.expr) === JSON.stringify(['Add', ['Divide', 'P', 2], 'w']))!
    const inst = instance('rectangle')
    expect(evaluateMutation(tpl, m, inst)).toBeCloseTo(inst.values.P / 2 + inst.values.w)
  })
})

describe('filtering', () => {
  const f = { decimals: 1 }
  it('drops what rounds to the answer, is too close, too far, or has the wrong sign', () => {
    expect(plausible(48.02, 48, 'order', f)).toBe(false) // same after rounding
    expect(plausible(48.6, 48, 'order', f)).toBe(false) // under 2% away
    expect(plausible(49.2, 48, 'order', f)).toBe(true)
    expect(plausible(48_001, 48, 'order', f)).toBe(false) // over 1000×
    expect(plausible(0.04, 48, 'order', { decimals: 3 })).toBe(false) // under 1/1000
    expect(plausible(-48, 48, 'order', f)).toBe(false) // wrong sign
    expect(plausible(-48, 48, 'sign', f)).toBe(true) // unless it's the sign slip
    expect(plausible(Infinity, 48, 'order', f)).toBe(false)
  })
})

describe('choosing options', () => {
  it('every sample, over 50 instances, gets the answer and 3 plausible wrong options', () => {
    let wrong = 0
    let nearMisses = 0
    const rules = new Set<string>()
    for (const [name, draft] of Object.entries(SAMPLES)) {
      const tpl = asTemplate(draft)
      for (const inst of generateMany(tpl, 50, Array.from({ length: 50 }, (_, i) => `${name}-${i}`))) {
        const options = chooseOptions(tpl, inst)
        expect(options, name).toHaveLength(4)
        expect(options.filter((o) => o.correct)).toEqual([{ value: roundAnswer(inst.answer, tpl.answerFormat), correct: true }])
        expect(new Set(options.map((o) => o.value)).size).toBe(4)
        for (const o of options.filter((x) => !x.correct)) {
          expect(plausible(o.value, inst.answer, o.rule!, tpl.answerFormat)).toBe(true)
          expect(o.why?.text).toBeTruthy()
          // Shown exactly as rounded: the same shape as the answer.
          expect(roundAnswer(o.value, tpl.answerFormat)).toBe(o.value)
          wrong++
          if (o.rule === 'near-miss') nearMisses++
          rules.add(o.rule!)
        }
      }
    }
    expect(wrong).toBe(10 * 50 * 3)
    // Nearly all come from real mistakes, not the near-miss fallback.
    expect(nearMisses / wrong).toBeLessThan(0.1)
    expect(rules).toEqual(new Set(['order', 'dropped-factor', 'dropped-term', 'sign', 'inverted', 'power', 'wrong-variable', 'unit', 'near-miss']))
  })

  it('the same instance always gets the same options, in the same order', () => {
    expect(chooseOptions(t('speed'), instance('speed'))).toEqual(chooseOptions(t('speed'), instance('speed')))
  })

  it('puts the answer in different positions', () => {
    const positions = new Set(generateMany(t('ohm'), 40).map((inst) => chooseOptions(t('ohm'), inst).findIndex((o) => o.correct)))
    expect(positions.size).toBe(4)
  })

  it('prefers the author’s own wrong answers', () => {
    const tpl = asTemplate({ ...SAMPLES.circleArea, customDistractors: [{ expr: ['Multiply', 'Pi', ['Power', ['Multiply', 2, 'r'], 2]], label: 'Used the diameter instead of the radius' }] })
    for (const inst of generateMany(tpl, 20)) {
      const custom = chooseOptions(tpl, inst).find((o) => o.rule === 'custom')
      expect(custom?.why?.text).toBe('Used the diameter instead of the radius')
    }
  })
})

describe('diagnosing a typed answer', () => {
  it('names the mistake a wrong number matches', () => {
    const inst = instance('speed')
    expect(diagnose(t('speed'), inst, inst.values.t / inst.values.d)?.rule).toBe('inverted')
    expect(diagnose(t('speed'), inst, inst.answer)).toBeNull()
    expect(diagnose(t('speed'), inst, 123456)).toBeNull()
  })
})
