// Ten sample templates: the engine's test set (SPEC-v2.md, B1), and examples to
// start from. Formulas are MathJSON as MathLive and the Compute Engine write it.

import type { ProblemTemplate } from '../../types'
import type { TemplateDraft } from './store'

const base = { mode: 'formula' as const, derived: [], constraints: [], customDistractors: [], answerMode: 'choice' as const }

export const SAMPLES: Record<string, TemplateDraft> = {
  speed: {
    ...base,
    title: 'Average speed',
    texts: ['A car travels {d} km in {t} h. {What is|Find} its average speed?'],
    vars: [
      { name: 'd', unit: 'km', source: { kind: 'range', min: 20, max: 200, step: 5 } },
      { name: 't', unit: 'h', source: { kind: 'range', min: 0.5, max: 5, step: 0.5 } },
    ],
    answer: ['Divide', 'd', 't'],
    answerFormat: { decimals: 1, unit: 'km/h' },
  },
  kineticEnergy: {
    ...base,
    title: 'Kinetic energy',
    texts: ['A {m} kg cart moves at {v} m/s. What is its kinetic energy?'],
    vars: [
      { name: 'm', unit: 'kg', source: { kind: 'range', min: 1, max: 50, step: 1 } },
      { name: 'v', unit: 'm/s', source: { kind: 'range', min: 1, max: 20, step: 0.5 } },
    ],
    answer: ['Multiply', ['Rational', 1, 2], 'm', ['Power', 'v', 2]],
    answerFormat: { sigFigs: 3, unit: 'J' },
  },
  quadratic: {
    ...base,
    title: 'Larger root of a quadratic',
    texts: ['Find the larger root of {a}x² + {b}x + {c} = 0.'],
    vars: [
      { name: 'a', source: { kind: 'range', min: -5, max: 5, step: 1 }, exclude: [0] },
      { name: 'b', source: { kind: 'range', min: -10, max: 10, step: 1 } },
      { name: 'c', source: { kind: 'range', min: -10, max: 10, step: 1 } },
    ],
    derived: [{ name: 'D', expr: ['Subtract', ['Power', 'b', 2], ['Multiply', 4, 'a', 'c']] }],
    constraints: [['GreaterEqual', 'D', 0]],
    answer: [
      'Max',
      ['Divide', ['Add', ['Negate', 'b'], ['Sqrt', 'D']], ['Multiply', 2, 'a']],
      ['Divide', ['Subtract', ['Negate', 'b'], ['Sqrt', 'D']], ['Multiply', 2, 'a']],
    ],
    answerFormat: { decimals: 2 },
  },
  discount: {
    ...base,
    title: 'Sale price',
    texts: ['A jacket costs {p} €. It is on sale at {r}% off. What does it cost now?'],
    vars: [
      { name: 'p', unit: '€', source: { kind: 'range', min: 20, max: 300, step: 5 } },
      { name: 'r', unit: '%', source: { kind: 'list', values: [10, 15, 20, 25, 30, 40, 50] } },
    ],
    answer: ['Multiply', 'p', ['Subtract', 1, ['Divide', 'r', 100]]],
    answerFormat: { decimals: 2, unit: '€' },
  },
  ohm: {
    ...base,
    title: 'Current through a resistor',
    texts: ['{Find|Calculate} the current through a {R} Ω resistor connected across {V} V.'],
    vars: [
      { name: 'V', unit: 'V', source: { kind: 'range', min: 1.5, max: 24, step: 0.5 } },
      { name: 'R', unit: 'Ω', source: { kind: 'range', min: 10, max: 1000, step: 10 } },
    ],
    answer: ['Divide', 'V', 'R'],
    answerFormat: { sigFigs: 3, unit: 'A' },
  },
  compoundInterest: {
    ...base,
    title: 'Compound interest',
    texts: [
      'You put {P} € in an account paying {r}% a year, compounded yearly. How much is there after {n} years?',
      'An investment of {P} € grows by {r}% each year. What is it worth after {n} years?',
    ],
    vars: [
      { name: 'P', unit: '€', source: { kind: 'range', min: 500, max: 10000, step: 100 } },
      { name: 'r', unit: '%', source: { kind: 'range', min: 1, max: 8, step: 0.5 } },
      { name: 'n', unit: 'years', source: { kind: 'range', min: 1, max: 30, step: 1 } },
    ],
    answer: ['Multiply', 'P', ['Power', ['Add', 1, ['Divide', 'r', 100]], 'n']],
    answerFormat: { decimals: 2, unit: '€' },
  },
  hypotenuse: {
    ...base,
    title: 'Hypotenuse',
    texts: ['A right triangle has legs of {a} cm and {b} cm. How long is the hypotenuse?'],
    vars: [
      { name: 'a', unit: 'cm', source: { kind: 'list', values: [3, 5, 6, 8, 9, 12] } },
      { name: 'b', unit: 'cm', source: { kind: 'range', min: 1, max: 20, step: 1 } },
    ],
    answer: ['Sqrt', ['Add', ['Power', 'a', 2], ['Power', 'b', 2]]],
    answerFormat: { decimals: 2, unit: 'cm' },
  },
  circleArea: {
    ...base,
    title: 'Area of a circle',
    texts: ['What is the area of a circle with radius {r} cm?'],
    vars: [{ name: 'r', unit: 'cm', source: { kind: 'range', min: 0.5, max: 10, step: 0.5 } }],
    answer: ['Multiply', 'Pi', ['Square', 'r']],
    answerFormat: { sigFigs: 3, unit: 'cm²' },
  },
  projectile: {
    ...base,
    title: 'Range of a projectile',
    texts: ['A ball is thrown at {v} m/s, {theta}° above the horizontal. How far does it land, on level ground (g = 9.81 m/s²)?'],
    vars: [
      { name: 'v', unit: 'm/s', source: { kind: 'range', min: 5, max: 40, step: 1 } },
      { name: 'theta', unit: '°', source: { kind: 'range', min: 15, max: 75, step: 5 } },
    ],
    derived: [{ name: 'g', expr: { num: '9.81' } }],
    answer: ['Divide', ['Multiply', ['Power', 'v', 2], ['Sin', ['Multiply', 2, ['Degrees', 'theta']]]], 'g'],
    answerFormat: { decimals: 1, unit: 'm' },
  },
  rectangle: {
    ...base,
    title: 'Length of a rectangle',
    texts: ['A rectangle has a perimeter of {P} cm and is {w} cm wide. How long is it?'],
    vars: [
      { name: 'P', unit: 'cm', source: { kind: 'range', min: 20, max: 100, step: 2 } },
      { name: 'w', unit: 'cm', source: { kind: 'range', min: 1, max: 30, step: 1 } },
    ],
    derived: [{ name: 'l', expr: ['Subtract', ['Divide', 'P', 2], 'w'] }],
    constraints: [['Greater', 'l', 'w']], // longer than wide
    answer: ['Delimiter', 'l'],
    answerFormat: { decimals: 0, unit: 'cm' },
  },
}

// A draft as a full template, for tests and previews that don't touch the database.
export function asTemplate(draft: TemplateDraft, id = 'sample'): ProblemTemplate {
  return {
    ...draft,
    id,
    elementId: 'samples',
    srs: { due: 0, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0 },
    createdAt: 0,
    updatedAt: 0,
  }
}
