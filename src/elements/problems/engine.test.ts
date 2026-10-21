import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { exportBackup, importBackup } from '../../store/backup'
import { createElement, createLocus, db, deleteLocus } from '../../store/db'
import type { MathJSON, ProblemTemplate, VarSpec } from '../../types'
import { decimalsOf, generate, generateMany, isCorrect, lastPlace, parseText, pickQuestion, rngFor, roundAnswer, sampleVar, validate } from './engine'
import { evaluate, MathError, symbolsOf, test } from './mathjson'
import { asTemplate, SAMPLES } from './samples'
import { createTemplate, deleteTemplate, emptyDraft, listTemplates } from './store'

const RUNS = 200

// What each sample's answer should be, worked out independently in plain JS.
const EXPECTED: Record<string, (v: Record<string, number>) => number> = {
  speed: (v) => v.d / v.t,
  kineticEnergy: (v) => 0.5 * v.m * v.v ** 2,
  quadratic: (v) => Math.max((-v.b + Math.sqrt(v.b ** 2 - 4 * v.a * v.c)) / (2 * v.a), (-v.b - Math.sqrt(v.b ** 2 - 4 * v.a * v.c)) / (2 * v.a)),
  discount: (v) => v.p * (1 - v.r / 100),
  ohm: (v) => v.V / v.R,
  compoundInterest: (v) => v.P * (1 + v.r / 100) ** v.n,
  hypotenuse: (v) => Math.hypot(v.a, v.b),
  circleArea: (v) => Math.PI * v.r ** 2,
  projectile: (v) => (v.v ** 2 * Math.sin((2 * v.theta * Math.PI) / 180)) / 9.81,
  rectangle: (v) => v.P / 2 - v.w,
}

function onGrid(spec: VarSpec, x: number): boolean {
  if ((spec.exclude ?? []).includes(x)) return false
  const s = spec.source
  if (s.kind === 'list') return s.values.includes(x)
  const k = (x - s.min) / s.step
  return x >= s.min - 1e-9 && x <= s.max + 1e-9 && Math.abs(k - Math.round(k)) < 1e-9 && decimalsOf(x) <= Math.max(decimalsOf(s.min), decimalsOf(s.step))
}

describe('the ten sample templates', () => {
  expect(Object.keys(SAMPLES)).toHaveLength(10)

  describe.each(Object.entries(SAMPLES))('%s', (name, draft) => {
    const t = asTemplate(draft)

    it('is a valid template', () => {
      expect(validate(t)).toEqual([])
    })

    it(`gives ${RUNS} instances with numbers in range, constraints met and the right answer`, () => {
      for (let i = 0; i < RUNS; i++) {
        const g = generate(t, `${name}-${i}`)
        expect(g.ok).toBe(true)
        if (!g.ok) return
        const { values, answer, question } = g.instance
        for (const spec of t.vars) expect(onGrid(spec, values[spec.name]), `${spec.name} = ${values[spec.name]}`).toBe(true)
        for (const c of t.constraints) expect(test(c, values)).toBe(true)
        expect(Number.isFinite(answer)).toBe(true)
        expect(answer).toBeCloseTo(EXPECTED[name](values), 9)
        for (const part of question) if (typeof part !== 'string') expect(part.var in values).toBe(true)
        expect(question.filter((p) => typeof p === 'string').join('')).not.toMatch(/[{}|]/)
      }
    })

    it('replays exactly from its seed', () => {
      expect(generate(t, 'same-seed')).toEqual(generate(t, 'same-seed'))
    })
  })
})

describe('sampling', () => {
  it('varies between seeds', () => {
    const answers = new Set(Array.from({ length: 50 }, (_, i) => (generate(asTemplate(SAMPLES.speed), `s${i}`) as { instance: { answer: number } }).instance.answer))
    expect(answers.size).toBeGreaterThan(20)
  })

  it('snaps ranges to the step with no floating-point noise', () => {
    const spec: VarSpec = { name: 'x', source: { kind: 'range', min: 0.1, max: 0.9, step: 0.1 } }
    const rng = rngFor('noise')
    for (let i = 0; i < 300; i++) {
      const x = sampleVar(spec, rng)
      expect(decimalsOf(x)).toBeLessThanOrEqual(1)
      expect(x).toBeGreaterThanOrEqual(0.1)
      expect(x).toBeLessThanOrEqual(0.9)
    }
  })

  it('reaches both ends of a range', () => {
    const spec: VarSpec = { name: 'x', source: { kind: 'range', min: 20, max: 200, step: 5 } }
    const rng = rngFor('ends')
    const seen = new Set(Array.from({ length: 2000 }, () => sampleVar(spec, rng)))
    expect(seen.has(20) && seen.has(200)).toBe(true)
    expect(seen.size).toBe(37)
  })

  it('never picks an excluded value', () => {
    const t = asTemplate(SAMPLES.quadratic)
    for (const inst of generateMany(t, 300)) expect(inst.values.a).not.toBe(0)
  })

  it('tries other numbers instead of dividing by zero', () => {
    const t = asTemplate({ ...emptyDraft(), texts: ['{x}'], vars: [{ name: 'x', source: { kind: 'range', min: 1, max: 3, step: 1 } }], answer: ['Divide', 1, ['Subtract', 'x', 2]] })
    for (let i = 0; i < 100; i++) {
      const g = generate(t, `z${i}`)
      expect(g.ok && g.instance.values.x !== 2).toBe(true)
    }
  })

  it('tries other numbers when a root of a negative number comes up', () => {
    const t = asTemplate({ ...emptyDraft(), texts: ['{x}'], vars: [{ name: 'x', source: { kind: 'range', min: -5, max: 5, step: 1 } }], answer: ['Sqrt', 'x'] })
    for (const inst of generateMany(t, 100)) expect(inst.values.x).toBeGreaterThanOrEqual(0)
  })

  it('gives up after 200 tries when the constraints leave nothing', () => {
    const t = asTemplate({
      ...emptyDraft(),
      texts: ['{a}'],
      vars: [{ name: 'a', source: { kind: 'range', min: 1, max: 10, step: 1 } }],
      answer: 'a',
      constraints: [['Greater', 'a', 20]],
    })
    expect(generate(t, 'tight')).toEqual({ ok: false, reason: 'too-tight' })
  })

  it('leaves relation mode for v2.1', () => {
    expect(generate({ ...asTemplate(SAMPLES.speed), mode: 'relation' }, 'r')).toEqual({ ok: false, reason: 'relation-mode' })
  })
})

describe('wordings', () => {
  it('splits text, variables and alternatives', () => {
    expect(parseText('{Find|Calculate} {d} km {} end')).toEqual([
      { kind: 'alt', options: ['Find', 'Calculate'] },
      { kind: 'text', text: ' ' },
      { kind: 'var', name: 'd' },
      { kind: 'text', text: ' km {} end' },
    ])
  })

  it('picks every alternative and every wording across seeds', () => {
    const texts = ['{Find|Calculate} {x}.', 'What is {x}?']
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const { question } = pickQuestion(texts, rngFor(`w${i}`))
      seen.add(String(question[0]))
    }
    expect(seen).toEqual(new Set(['Find ', 'Calculate ', 'What is ']))
  })
})

describe('evaluating MathJSON', () => {
  const ev = (e: MathJSON, scope = {}) => evaluate(e, scope)

  it('handles the forms MathLive and the Compute Engine produce', () => {
    expect(ev(['Rational', 1, 3])).toBeCloseTo(1 / 3)
    expect(ev(['Half', 5])).toBe(2.5)
    expect(ev(['Root', -8, 3])).toBeCloseTo(-2)
    expect(ev(['Log', 8, 2])).toBeCloseTo(3)
    expect(ev(['Log', 1000])).toBeCloseTo(3)
    expect(ev(['Ln', 'ExponentialE'])).toBeCloseTo(1)
    expect(ev(['Sin', ['Degrees', 30]])).toBeCloseTo(0.5)
    expect(ev(['Delimiter', ['Sequence', ['Add', 1, 2]]])).toBe(3)
    expect(ev({ num: '0.(3)' })).toBeCloseTo(1 / 3)
    expect(ev({ num: '2.5' })).toBe(2.5)
    expect(ev(['Subtract', 5])).toBe(-5)
    expect(ev(['Subtract', 10, 3, 2])).toBe(5)
    expect(ev(['Multiply', 2, 'x', ['Power', 'x', -1]], { x: 4 })).toBe(2)
  })

  it('reads chained comparisons and logic', () => {
    expect(test(['Less', 0, 'a', 10], { a: 5 })).toBe(true)
    expect(test(['Less', 0, 'a', 10], { a: 10 })).toBe(false)
    expect(test(['And', ['Greater', 'a', 1], ['NotEqual', 'a', 3]], { a: 3 })).toBe(false)
    expect(test(['Equal', ['Add', 0.1, 0.2], 0.3], {})).toBe(true)
  })

  it('says what went wrong', () => {
    expect(() => ev('q')).toThrow(MathError)
    expect(() => ev(['Zeta', 2])).toThrow(/isn’t supported/)
    expect(() => ev(['Divide', 1, 0])).toThrowError(expect.objectContaining({ kind: 'divide-by-zero' }))
    expect(() => ev(['Sqrt', -1])).toThrowError(expect.objectContaining({ kind: 'not-real' }))
  })

  it('lists the variables a formula uses, not constants', () => {
    expect(symbolsOf(['Multiply', 'Pi', ['Square', 'r'], 'h'])).toEqual(new Set(['r', 'h']))
  })
})

describe('checking a template', () => {
  const t = (patch: Partial<ProblemTemplate>) => validate({ ...asTemplate(SAMPLES.speed), ...patch })

  it('catches unknown variables, bad names and bad ranges', () => {
    expect(t({ answer: ['Divide', 'd', 'x'] })).toEqual(['The answer uses “x”, which isn’t a variable.'])
    expect(t({ texts: ['Go {s} km'] })).toEqual(['The text mentions {s}, which isn’t a variable.'])
    expect(t({ vars: [{ name: 'd', source: { kind: 'range', min: 5, max: 1, step: 1 } }, { name: 't', source: { kind: 'range', min: 1, max: 2, step: 0 } }] })).toEqual([
      '“d”: the minimum is above the maximum.',
      '“t”: the step has to be more than 0.',
    ])
    expect(t({ vars: [...SAMPLES.speed.vars, { name: 'd', source: { kind: 'list', values: [1] } }] })).toContain('Two variables are called “d”.')
    expect(t({ vars: [...SAMPLES.speed.vars, { name: 'Pi', source: { kind: 'list', values: [1] } }] })).toContain('“Pi” is a built-in constant; pick another name.')
    expect(t({ vars: [...SAMPLES.speed.vars, { name: 'k', source: { kind: 'list', values: [0] }, exclude: [0] }] })).toContain('“k”: every value is excluded.')
  })

  it('needs derived values in order, and constraints that compare', () => {
    expect(t({ derived: [{ name: 'a', expr: ['Add', 'b', 1] }, { name: 'b', expr: 'd' }] })).toEqual(['“a” uses “b”, which isn’t a variable.'])
    expect(t({ constraints: [['Add', 'd', 1]] })).toEqual(['Constraint 1 has to compare two things, e.g. a > 0.'])
  })
})

describe('answers', () => {
  it('round to decimals or significant figures (3 by default)', () => {
    expect(roundAnswer(48, { decimals: 1 })).toBe(48)
    expect(roundAnswer(1234.5678, { sigFigs: 3 })).toBe(1230)
    expect(roundAnswer(0.012345, {})).toBe(0.0123)
    expect(lastPlace(48, {})).toBeCloseTo(0.1)
    expect(lastPlace(0.012345, {})).toBeCloseTo(0.0001)
  })

  it('accept a typed answer within one unit of the last digit', () => {
    expect(isCorrect(48.1, 48, {})).toBe(true)
    expect(isCorrect(48.2, 48, {})).toBe(false)
    expect(isCorrect(3.14, Math.PI, { decimals: 2 })).toBe(true)
    expect(isCorrect(3.12, Math.PI, { decimals: 2 })).toBe(false)
    expect(isCorrect(NaN, 1, {})).toBe(false)
  })
})

describe('storage', () => {
  beforeEach(() => Promise.all(db.tables.map((t) => t.clear())))

  async function setup() {
    const locus = await createLocus({ name: 'Physics', color: '#000000', x: 0, y: 0 })
    const set = await createElement(locus.id, 'problems', 'Kinematics', {})
    const now = new Date(2026, 9, 21, 10).getTime()
    const t = await createTemplate(set.id, SAMPLES.speed, now)
    return { locus, set, t, now }
  }

  it('a new template is due straight away', async () => {
    const { t, now } = await setup()
    expect(t.srs.due).toBeLessThanOrEqual(now)
    expect(t.tooTight).toBeUndefined()
  })

  it('flags a template whose constraints leave no numbers', async () => {
    const { set } = await setup()
    const t = await createTemplate(set.id, { ...SAMPLES.speed, constraints: [['Greater', 'd', 1000]] })
    expect(t.tooTight).toBe(true)
  })

  it('deleting a template takes its attempts and links', async () => {
    const { t } = await setup()
    await db.problemAttempts.add({ id: 'a1', templateId: t.id, at: 1, seed: 's', answer: 1, given: 1, correct: true, ms: 1, grade: 2, updatedAt: 1 })
    await db.links.add({ id: 'l1', from: { type: 'template', id: t.id }, to: { type: 'note', id: 'n' }, kind: 'related', createdAt: 1, updatedAt: 1 })
    await deleteTemplate(t.id)
    expect([await db.problemTemplates.count(), await db.problemAttempts.count(), await db.links.count()]).toEqual([0, 0, 0])
  })

  it('deleting the locus takes its problem sets, templates and attempts', async () => {
    const { locus, t } = await setup()
    await db.problemAttempts.add({ id: 'a1', templateId: t.id, at: 1, seed: 's', answer: 1, given: 1, correct: true, ms: 1, grade: 2, updatedAt: 1 })
    await deleteLocus(locus.id)
    expect([await db.problemTemplates.count(), await db.problemAttempts.count()]).toEqual([0, 0])
  })

  it('templates and attempts survive a backup round trip', async () => {
    const { set, t } = await setup()
    await db.problemAttempts.add({ id: 'a1', templateId: t.id, at: 1, seed: 's', answer: 1, given: 1, correct: true, ms: 1, grade: 2, updatedAt: 1 })
    const backup = await exportBackup()
    await Promise.all(db.tables.map((tb) => tb.clear()))
    await importBackup(backup, 'replace')
    expect(await listTemplates(set.id)).toEqual([t])
    expect(await db.problemAttempts.count()).toBe(1)
  })
})
