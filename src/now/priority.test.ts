import { describe, expect, it } from 'vitest'
import type { Task } from '../elements/registry'
import { compareRanked, examPace, goalPace, intervalWord, missedTerm, priority, type Ranked, type Terms, urgencyDated, urgencyStudy, whyLine } from './priority'

// The six test vectors of SPEC-v5-now.md, built from the term functions.
const vectors: { id: string; terms: Terms; score: number }[] = [
  { id: 'T3', terms: { I: 3, U: urgencyStudy(50), B: examPace(0.75), N: 0, S: 0 }, score: 12.5 },
  { id: 'T1', terms: { I: 4, U: 0, B: 0, N: 0, S: 0 }, score: 12 },
  { id: 'T2', terms: { I: 2, U: urgencyDated(84), B: 0, N: 0, S: 0 }, score: 8 },
  { id: 'T4', terms: { I: 2, U: urgencyDated(24), B: 0, N: missedTerm(2), S: 0 }, score: 7.57 },
  { id: 'T6', terms: { I: 2, U: 0, B: goalPace(12), N: 0, S: 0 }, score: 7.2 },
  { id: 'T5', terms: { I: 2, U: urgencyDated(84), B: 0, N: 0, S: 1 }, score: 5 },
]

describe('priority score', () => {
  it.each(vectors)('$id scores $score', ({ terms, score }) => {
    expect(priority(terms)).toBeCloseTo(score, 2)
  })

  it('ranks the vectors T3 > T1 > T2 > T4 > T6 > T5', () => {
    const ranked = [...vectors].sort((a, b) => priority(b.terms) - priority(a.terms)).map((v) => v.id)
    expect(ranked).toEqual(['T3', 'T1', 'T2', 'T4', 'T6', 'T5'])
  })

  it('terms saturate at 1 and never go below 0', () => {
    expect(urgencyDated(1000)).toBe(1)
    expect(urgencyDated(-5)).toBe(0)
    expect(urgencyStudy(250)).toBe(1)
    expect(goalPace(80)).toBe(1)
    expect(goalPace(2)).toBe(0) // still "On pace"
    expect(goalPace(-10)).toBe(0)
    expect(examPace(0.95)).toBe(0) // above target
    expect(examPace(0)).toBe(1)
    expect(missedTerm(5)).toBe(1)
  })
})

describe('compareRanked', () => {
  const rank = (key: string, p: number): Ranked => ({ key, type: 'todo', priority: p, terms: { I: 2, U: 0, B: 0, N: 0, S: 0 }, why: '' })
  const task = (o: Partial<Task>): Task => ({ locusId: 'l', elementId: 'e', kind: 'todo', state: 'due', label: 'x', importance: 2, difficulty: 2, open: () => {}, ...o })

  it('breaks ties by overdue, then earlier due, then key', () => {
    const a = task({ label: 'a', rank: rank('b', 8), state: 'due', dueAt: 100 })
    const b = task({ label: 'b', rank: rank('a', 8), state: 'overdue', dueAt: 900 })
    const c = task({ label: 'c', rank: rank('c', 8), state: 'due', dueAt: 50 })
    const d = task({ label: 'd', rank: rank('d', 8), state: 'due', dueAt: 50 })
    expect([a, b, c, d].sort(compareRanked).map((t) => t.label)).toEqual(['b', 'c', 'd', 'a'])
  })
})

describe('whyLine', () => {
  const zero: Terms = { I: 2, U: 0, B: 0, N: 0, S: 0 }

  it('names the largest weighted term', () => {
    expect(whyLine({ ...zero, U: 0.2, B: 0.75 }, { importance: 3, exam: { days: 10, readiness: 0.75 } })).toBe('Exam in 10 days · readiness 75%')
    // T3: 4 × 0.5 = 2 outweighs 2 × 0.75 = 1.5, so the count leads.
    expect(whyLine({ I: 3, U: 0.5, B: 0.75, N: 0, S: 0 }, { importance: 3, studyDue: 50, exam: { days: 10, readiness: 0.75 } })).toBe('50 due')
    expect(whyLine({ ...zero, B: 0.6 }, { importance: 2, goal: { title: 'B2 Spanish', behind: 12 } })).toBe('Moves "B2 Spanish" · 12% behind pace')
    expect(whyLine({ ...zero, U: 0.43 }, { importance: 2, daysLate: 3 })).toBe('3 days late')
    expect(whyLine({ ...zero, U: 0.5 }, { importance: 3, studyDue: 50 })).toBe('50 due')
    expect(whyLine({ ...zero, N: 0.667 }, { importance: 2, repeat: { interval: 'Weekly', lastDone: new Date(2026, 9, 16).getTime() } })).toBe('Weekly · last done Oct 16')
  })

  it('says 1 day, not 1 days', () => {
    expect(whyLine({ ...zero, U: 0.1 }, { importance: 2, daysLate: 1 })).toBe('1 day late')
  })

  it('compares the weighted terms, not the raw ones', () => {
    // 4 × 0.2 = 0.8 beats 1.5 × 0.5 = 0.75
    expect(whyLine({ ...zero, U: 0.2, N: 0.5 }, { importance: 2, daysLate: 2, repeat: { interval: 'Daily' } })).toBe('2 days late')
  })

  it('falls back to the importance label, with no exclamation marks anywhere', () => {
    expect(whyLine(zero, { importance: 4 })).toBe('Critical')
    expect(whyLine({ ...zero, N: 0.5 }, { importance: 2, repeat: { interval: 'Daily' } })).not.toContain('!')
    expect(whyLine({ ...zero, N: 0.5 }, { importance: 2, repeat: { interval: 'Daily' } })).toBe('Daily · not done yet')
  })
})

describe('intervalWord', () => {
  it('reads the repeat rule in a word', () => {
    expect(intervalWord('DTSTART:20260101T040000Z\nRRULE:FREQ=WEEKLY;BYDAY=SU')).toBe('Weekly')
    expect(intervalWord('RRULE:FREQ=DAILY')).toBe('Daily')
    expect(intervalWord('RRULE:FREQ=WEEKLY;INTERVAL=2')).toBe('Every 2 weeks')
    expect(intervalWord('nonsense')).toBe('Repeats')
  })
})
